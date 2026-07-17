import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "@/lib/types";
import { sanitizeBlocks, type DocBlock } from "@/lib/documentBlocks";

/* Server-side document generation: merges text blocks via render_merge_tags and
   renders smart blocks from event data, freezing everything into the document
   snapshot. Output uses xdoc-* classes styled by the DocumentShell. */

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "TBD";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function fmtTime(t: string | null | undefined): string {
  if (!t) return "TBD";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

export type EventBundle = {
  event: Record<string, unknown> & {
    id: string;
    name: string;
    event_date: string | null;
    setup_time: string | null;
    start_time: string | null;
    end_time: string | null;
    guest_count: number | null;
    package_id: string | null;
    package_price_override: number | null;
    package_price_locked: number | null;
    package_version_no: number | null;
    overtime_fee: number;
    travel_fee: number;
    discount1_label: string | null;
    discount1_amount: number;
    discount2_label: string | null;
    discount2_amount: number;
    client: { first_name: string; last_name: string; email: string | null } | null;
    venue: { name: string; address: string | null; city: string | null; state: string | null; setup_fee: number } | null;
    package: { name: string; client_facing_name: string | null; default_price: number; description: string | null } | null;
    event_type: { name: string } | null;
  };
  addons: { quantity: number; price_override: number | null; price_locked: number | null; addon: { name: string; client_facing_name?: string | null; description: string | null; default_price: number } | null }[];
  schedule: { seq: number; due_date: string | null; amount: number; label: string | null }[];
  pinnedDescription: string | null;
  total: number;
};

export async function loadEventBundle(supabase: SupabaseClient, eventId: string): Promise<EventBundle | null> {
  const [{ data: event }, { data: addons }, { data: schedule }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "*, client:clients(first_name, last_name, email), venue:venues(name, address, city, state, setup_fee), package:packages(name, client_facing_name, default_price, description), event_type:event_types(name)"
      )
      .eq("id", eventId)
      .single(),
    supabase
      .from("event_addons")
      .select("quantity, price_override, price_locked, addon:addons(name, client_facing_name, description, default_price)")
      .eq("event_id", eventId),
    supabase.from("scheduled_payments").select("seq, due_date, amount, label").eq("event_id", eventId).order("seq"),
  ]);
  if (!event) return null;

  // description pinned to the version the event was sold with
  let pinnedDescription = (event.package as { description?: string | null } | null)?.description ?? null;
  if (event.package_id && event.package_version_no != null) {
    const { data: ver } = await supabase
      .from("package_versions")
      .select("snapshot")
      .eq("package_id", event.package_id)
      .eq("version_no", event.package_version_no)
      .maybeSingle();
    const snapDesc = (ver?.snapshot as { description?: string | null } | undefined)?.description;
    if (snapDesc !== undefined) pinnedDescription = snapDesc ?? null;
  }

  const e = event as unknown as EventBundle["event"];
  const addonRows = (addons ?? []) as unknown as EventBundle["addons"];
  const pkgPrice = Number(e.package_price_override ?? e.package_price_locked ?? e.package?.default_price ?? 0);
  const addonsTotal = addonRows.reduce(
    (s, a) => s + a.quantity * Number(a.price_override ?? a.price_locked ?? a.addon?.default_price ?? 0),
    0
  );
  const total =
    pkgPrice +
    addonsTotal +
    Number(e.overtime_fee) +
    Number(e.travel_fee) +
    Number(e.venue?.setup_fee ?? 0) -
    Number(e.discount1_amount) -
    Number(e.discount2_amount);

  return { event: e, addons: addonRows, schedule: schedule ?? [], pinnedDescription, total };
}

/** Structured fee lines — shared by the document fee table and the quote-style emails. */
export function feeSummary(b: EventBundle): {
  packageLine: { name: string; description: string | null; amount: number } | null;
  addonLines: { name: string; description: string | null; amount: number }[];
  feeLines: { name: string; amount: number }[];
  discountLines: { name: string; amount: number }[];
  total: number;
} {
  const e = b.event;
  const pkgPrice = Number(e.package_price_override ?? e.package_price_locked ?? e.package?.default_price ?? 0);
  const packageLine = e.package
    ? { name: e.package.client_facing_name || e.package.name, description: b.pinnedDescription, amount: pkgPrice }
    : null;
  const addonLines = b.addons.map((a) => ({
    name: `${(a.addon?.client_facing_name as string | null) || a.addon?.name || "Add-On"}${a.quantity > 1 ? ` × ${a.quantity}` : ""}`,
    description: a.addon?.description ?? null,
    amount: Number(a.price_override ?? a.price_locked ?? a.addon?.default_price ?? 0) * a.quantity,
  }));
  const feeLines: { name: string; amount: number }[] = [];
  if (Number(e.overtime_fee) > 0) feeLines.push({ name: "Overtime", amount: Number(e.overtime_fee) });
  if (Number(e.travel_fee) > 0) feeLines.push({ name: "Travel Fee", amount: Number(e.travel_fee) });
  if (Number(e.venue?.setup_fee ?? 0) > 0) feeLines.push({ name: "Venue Setup Fee", amount: Number(e.venue?.setup_fee) });
  const discountLines: { name: string; amount: number }[] = [];
  if (Number(e.discount1_amount) > 0) discountLines.push({ name: e.discount1_label || "Discount", amount: Number(e.discount1_amount) });
  if (Number(e.discount2_amount) > 0) discountLines.push({ name: e.discount2_label || "Discount", amount: Number(e.discount2_amount) });
  return { packageLine, addonLines, feeLines, discountLines, total: b.total };
}

export function renderFeeTable(b: EventBundle): string {
  const e = b.event;
  const pkgPrice = Number(e.package_price_override ?? e.package_price_locked ?? e.package?.default_price ?? 0);
  const rows: string[] = [];

  if (e.package) {
    rows.push(
      `<tr><td><strong>${esc(e.package.client_facing_name || e.package.name)}</strong>${
        b.pinnedDescription ? `<div class="xdoc-desc">${esc(b.pinnedDescription)}</div>` : ""
      }</td><td class="xdoc-amount">${money(pkgPrice)}</td></tr>`
    );
  }
  for (const a of b.addons) {
    const unit = Number(a.price_override ?? a.price_locked ?? a.addon?.default_price ?? 0);
    rows.push(
      `<tr><td>${esc((a.addon?.client_facing_name as string | null) || a.addon?.name || "Add-On")}${a.quantity > 1 ? ` × ${a.quantity}` : ""}${
        a.addon?.description ? `<div class="xdoc-desc">${esc(a.addon.description)}</div>` : ""
      }</td><td class="xdoc-amount">${money(unit * a.quantity)}</td></tr>`
    );
  }
  if (Number(e.overtime_fee) > 0) rows.push(`<tr><td>Overtime</td><td class="xdoc-amount">${money(Number(e.overtime_fee))}</td></tr>`);
  if (Number(e.travel_fee) > 0) rows.push(`<tr><td>Travel Fee</td><td class="xdoc-amount">${money(Number(e.travel_fee))}</td></tr>`);
  if (Number(e.venue?.setup_fee ?? 0) > 0) rows.push(`<tr><td>Venue Setup Fee</td><td class="xdoc-amount">${money(Number(e.venue?.setup_fee))}</td></tr>`);
  if (Number(e.discount1_amount) > 0)
    rows.push(`<tr class="xdoc-discount"><td>${esc(e.discount1_label || "Discount")}</td><td class="xdoc-amount">−${money(Number(e.discount1_amount))}</td></tr>`);
  if (Number(e.discount2_amount) > 0)
    rows.push(`<tr class="xdoc-discount"><td>${esc(e.discount2_label || "Discount")}</td><td class="xdoc-amount">−${money(Number(e.discount2_amount))}</td></tr>`);

  return `<table class="xdoc-table"><thead><tr><th>Services</th><th class="xdoc-amount">Investment</th></tr></thead><tbody>${rows.join("")}</tbody><tfoot><tr><td>Total Investment</td><td class="xdoc-amount">${money(b.total)}</td></tr></tfoot></table>`;
}

export function renderPaymentSchedule(b: EventBundle): string {
  if (b.schedule.length === 0) {
    return `<p class="xdoc-muted">Payment schedule to be determined.</p>`;
  }
  const rows = b.schedule
    .map(
      (sp) =>
        `<tr><td>${esc(sp.label || (sp.seq === 1 ? "Retainer" : `Payment ${sp.seq}`))}</td><td>${sp.due_date ? fmtDate(sp.due_date) : "TBD"}</td><td class="xdoc-amount">${money(Number(sp.amount))}</td></tr>`
    )
    .join("");
  return `<table class="xdoc-table"><thead><tr><th>Payment</th><th>Due</th><th class="xdoc-amount">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderEventDetails(b: EventBundle): string {
  const e = b.event;
  const venueLine = e.venue
    ? `${esc(e.venue.name)}${e.venue.address ? ` — ${esc(e.venue.address)}` : ""}${e.venue.city ? `, ${esc(e.venue.city)}` : ""}${e.venue.state ? `, ${esc(e.venue.state)}` : ""}`
    : "To be determined";
  const cells = [
    ["Event", esc(e.name || e.event_type?.name || "Event")],
    ["Date", fmtDate(e.event_date)],
    ["Venue", venueLine],
    ["Setup", fmtTime(e.setup_time)],
    ["Start", fmtTime(e.start_time)],
    ["End", fmtTime(e.end_time)],
    ["Guests", e.guest_count ? String(e.guest_count) : "TBD"],
  ];
  return `<div class="xdoc-details">${cells
    .map(([k, v]) => `<div class="xdoc-detail"><span class="xdoc-detail-k">${k}</span><span class="xdoc-detail-v">${v}</span></div>`)
    .join("")}</div>`;
}

export function renderSignature(b: EventBundle): string {
  const client = b.event.client;
  const name = client ? `${client.first_name} ${client.last_name}`.trim() : "Client";
  return `<div class="xdoc-sign"><div class="xdoc-sign-line"></div><div class="xdoc-sign-name">${esc(name)}</div><div class="xdoc-sign-meta">Signature &nbsp;·&nbsp; Date</div></div>`;
}

/** Generates a frozen document for an event from a document template and
    returns the inserted row. Shared by the Documents UI and the email outbox. */
export async function generateDocumentRow(
  supabase: SupabaseClient,
  templateId: string,
  eventId: string,
  status: string = "draft"
): Promise<{ id: string; title: string; access_token: string; doc_type: string } | null> {
  const [{ data: template }, { data: event }] = await Promise.all([
    supabase.from("document_templates").select("*").eq("id", templateId).single(),
    supabase.from("events").select("id, name, client:clients(first_name, last_name)").eq("id", eventId).single(),
  ]);
  if (!template || !event) return null;

  const rendered = await renderBlocks(supabase, eventId, sanitizeBlocks(template.blocks));
  if (!rendered) return null;

  const client = event.client as unknown as { first_name: string; last_name: string } | null;
  const title = `${template.name} — ${client ? `${client.first_name} ${client.last_name}`.trim() : event.name || "Event"}`;

  const { data: doc, error } = await supabase
    .from("documents")
    .insert({
      template_id: templateId,
      event_id: eventId,
      title,
      doc_type: template.doc_type,
      blocks: rendered,
      status,
      // carry the photo-release opt-out flag so /sign shows the opt-out control
      photo_release: template.photo_release ?? false,
    })
    .select("id, title, access_token, doc_type")
    .single();
  if (error || !doc) return null;
  return doc;
}

export async function renderBlocks(
  supabase: SupabaseClient,
  eventId: string,
  blocks: DocBlock[]
): Promise<DocBlock[] | null> {
  const bundle = await loadEventBundle(supabase, eventId);
  if (!bundle) return null;

  const out: DocBlock[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      const { data: merged } = await supabase.rpc("render_merge_tags", {
        p_event_id: eventId,
        p_template: block.html ?? "",
      });
      out.push({ ...block, html: (merged as string | null) ?? block.html ?? "" });
    } else if (block.type === "section") {
      // collapsible chapter: merged title + body wrapped in a <details> the
      // shell styles (smaller legal text, auto-expands for print)
      const { data: mergedBody } = await supabase.rpc("render_merge_tags", {
        p_event_id: eventId,
        p_template: block.html ?? "",
      });
      const { data: mergedTitle } = await supabase.rpc("render_merge_tags", {
        p_event_id: eventId,
        p_template: block.title ?? "",
      });
      const title = ((mergedTitle as string | null) ?? block.title ?? "Section").trim() || "Section";
      out.push({
        ...block,
        title,
        html: `<details class="xdoc-sec"><summary>${esc(title)}</summary><div class="xdoc-sec-body">${
          (mergedBody as string | null) ?? block.html ?? ""
        }</div></details>`,
      });
    } else if (block.type === "fee_table") {
      out.push({ ...block, html: renderFeeTable(bundle) });
    } else if (block.type === "payment_schedule") {
      out.push({ ...block, html: renderPaymentSchedule(bundle) });
    } else if (block.type === "event_details") {
      out.push({ ...block, html: renderEventDetails(bundle) });
    } else if (block.type === "signature") {
      out.push({ ...block, html: renderSignature(bundle) });
    } else {
      out.push({ ...block, html: `<hr class="xdoc-divider" />` });
    }
  }
  return out;
}
