import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_FEE_TOTAL_LABEL,
  DEFAULT_SUMMARY_BALANCE_LABEL,
  DEFAULT_SUMMARY_PAID_IN_FULL_LABEL,
  DEFAULT_SUMMARY_PAID_LABEL,
  DEFAULT_SUMMARY_TOTAL_LABEL,
  defaultHeaderKicker,
  formatDocumentTitle,
  sanitizeBlocks,
  type DocBlock,
  type DocBlockOptions,
} from "@/lib/documentBlocks";
import { formatPaymentDate } from "@/lib/paymentDateFormat";
import {
  balanceDue,
  balanceStatus,
  clientFacingPaymentNotes,
  formatPaymentMethod,
  totalPaid,
  type ReceiptPayment,
} from "@/lib/paymentReceiptMerge";
import { splitSchedule, type SchedRow } from "@/lib/scheduleLock";
import { money } from "@/lib/types";

/* Server-side document generation: merges text blocks via render_merge_tags and
   renders smart blocks from event data, freezing everything into the document
   snapshot. Output uses xdoc-* classes styled by the DocumentShell. */

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Date-only calendar formatting (YYYY-MM-DD). Never shift by timezone. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "TBD";
  const day = d.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "TBD";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dd = Number(m[3]);
  return new Date(y, mo - 1, dd).toLocaleDateString("en-US", {
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
  addons: {
    quantity: number;
    price_override: number | null;
    price_locked: number | null;
    description_override?: string | null;
    addon: { name: string; client_facing_name?: string | null; description: string | null; default_price: number } | null;
  }[];
  schedule: SchedRow[];
  payments: ReceiptPayment[];
  pinnedDescription: string | null;
  /** venue-paid event (Villa Toscana / Booked EV): client-facing output shows no money */
  financialsHidden: boolean;
  contractNotes: string[];
  total: number;
};

export async function loadEventBundle(supabase: SupabaseClient, eventId: string): Promise<EventBundle | null> {
  const [{ data: event }, { data: addons }, { data: schedule }, { data: notes }, { data: paymentRows }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "*, client:clients(first_name, last_name, email), venue:venues(name, address, city, state, setup_fee), package:packages(name, client_facing_name, default_price, description), event_type:event_types(name)",
      )
      .eq("id", eventId)
      .single(),
    supabase
      .from("event_addons")
      .select("quantity, price_override, price_locked, description_override, addon:addons(name, client_facing_name, description, default_price)")
      .eq("event_id", eventId),
    supabase.from("scheduled_payments").select("id, seq, due_date, amount, label").eq("event_id", eventId).order("seq"),
    supabase.from("event_notes").select("body").eq("event_id", eventId).eq("kind", "contract").order("created_at"),
    supabase
      .from("payments")
      .select("amount, method, paid_at, processing_fee, reason, notes, bank_deposit_ref, status, deleted_at, legacy_djep_id, scheduled_payment_id")
      .eq("event_id", eventId)
      .order("paid_at", { ascending: true }),
  ]);
  if (!event) return null;

  const contractNotes = ((notes ?? []) as { body: string | null }[])
    .map((n) => (n.body ?? "").trim())
    .filter(Boolean);

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
  // this event's own wording (event Financials tab) wins
  const pkgOverride = (event as { package_description_override?: string | null }).package_description_override;
  if (pkgOverride) pinnedDescription = pkgOverride;

  const e = event as unknown as EventBundle["event"];
  const addonRows = (addons ?? []) as unknown as EventBundle["addons"];
  const pkgPrice = Number(e.package_price_override ?? e.package_price_locked ?? e.package?.default_price ?? 0);
  const addonsTotal = addonRows.reduce(
    (s, a) => s + a.quantity * Number(a.price_override ?? a.price_locked ?? a.addon?.default_price ?? 0),
    0,
  );
  const total =
    pkgPrice +
    addonsTotal +
    Number(e.overtime_fee) +
    Number(e.travel_fee) +
    Number(e.venue?.setup_fee ?? 0) -
    Number(e.discount1_amount) -
    Number(e.discount2_amount);

  const { data: hidden } = await supabase.rpc("event_financials_hidden", { p_event_id: eventId });
  const financialsHidden = hidden === true;

  const payments: ReceiptPayment[] = ((paymentRows ?? []) as {
    amount: number;
    method: string;
    paid_at: string;
    processing_fee?: number | null;
    reason?: string | null;
    notes?: string | null;
    bank_deposit_ref?: string | null;
    status?: string | null;
    deleted_at?: string | null;
    legacy_djep_id?: string | null;
    scheduled_payment_id?: string | null;
  }[]).map((p) => ({
    amount: Number(p.amount || 0),
    method: p.method,
    paidAt: p.paid_at,
    processingFee: p.processing_fee,
    reason: p.reason,
    notes: p.notes,
    bankDepositRef: p.bank_deposit_ref,
    status: p.status,
    deletedAt: p.deleted_at,
    legacyDjepId: p.legacy_djep_id,
    scheduledPaymentId: p.scheduled_payment_id,
  }));

  const scheduleRows: SchedRow[] = ((schedule ?? []) as {
    id: string;
    seq: number;
    due_date: string | null;
    amount: number;
    label: string | null;
  }[]).map((s) => ({
    id: s.id,
    seq: s.seq,
    due_date: s.due_date,
    amount: Number(s.amount),
    label: s.label,
  }));

  return {
    event: e,
    addons: addonRows,
    schedule: scheduleRows,
    payments,
    pinnedDescription,
    contractNotes,
    total,
    financialsHidden,
  };
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
    description: a.description_override || a.addon?.description || null,
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

function descHtml(text: string | null | undefined, show: boolean): string {
  if (!show || !text) return "";
  return `<div class="xdoc-desc">${esc(text)}</div>`;
}

export function renderFeeTable(b: EventBundle, options?: DocBlockOptions): string {
  const e = b.event;
  const showDescriptions = options?.showDescriptions !== false;
  const showQty = options?.showQty === true;
  const totalLabel = (options?.totalLabel ?? "").trim() || DEFAULT_FEE_TOTAL_LABEL;

  // venue-paid: list the services, never what the venue pays us
  if (b.financialsHidden) {
    const items: string[] = [];
    if (e.package)
      items.push(
        `<tr><td><strong>${esc(e.package.client_facing_name || e.package.name)}</strong>${descHtml(
          b.pinnedDescription,
          showDescriptions,
        )}</td></tr>`,
      );
    for (const a of b.addons)
      items.push(
        `<tr><td>${esc((a.addon?.client_facing_name as string | null) || a.addon?.name || "Add-On")}${
          a.quantity > 1 ? ` × ${a.quantity}` : ""
        }${descHtml((a.description_override || a.addon?.description) as string | null, showDescriptions)}</td></tr>`,
      );
    return `<table class="xdoc-table"><thead><tr><th>Services</th></tr></thead><tbody>${items.join("")}</tbody></table>`;
  }

  const rows: string[] = [];

  if (showQty) {
    const pushLine = (
      name: string,
      description: string | null,
      qty: number | null,
      unit: number | null,
      amount: number,
      discount = false,
    ) => {
      const qtyCell = qty == null ? "" : String(qty);
      const unitCell = unit == null ? "" : money(unit);
      const amt = discount ? `−${money(amount)}` : money(amount);
      rows.push(
        `<tr${discount ? ' class="xdoc-discount"' : ""}><td><strong>${esc(name)}</strong>${descHtml(
          description,
          showDescriptions,
        )}</td><td class="xdoc-qty">${qtyCell}</td><td class="xdoc-amount">${unitCell}</td><td class="xdoc-amount">${amt}</td></tr>`,
      );
    };

    if (e.package) {
      const pkgPrice = Number(e.package_price_override ?? e.package_price_locked ?? e.package?.default_price ?? 0);
      pushLine(e.package.client_facing_name || e.package.name, b.pinnedDescription, 1, pkgPrice, pkgPrice);
    }
    for (const a of b.addons) {
      const unit = Number(a.price_override ?? a.price_locked ?? a.addon?.default_price ?? 0);
      const qty = Number(a.quantity) || 1;
      pushLine(
        (a.addon?.client_facing_name as string | null) || a.addon?.name || "Add-On",
        (a.description_override || a.addon?.description) as string | null,
        qty,
        unit,
        unit * qty,
      );
    }
    if (Number(e.overtime_fee) > 0) pushLine("Overtime", null, 1, Number(e.overtime_fee), Number(e.overtime_fee));
    if (Number(e.travel_fee) > 0) pushLine("Travel Fee", null, 1, Number(e.travel_fee), Number(e.travel_fee));
    if (Number(e.venue?.setup_fee ?? 0) > 0)
      pushLine("Venue Setup Fee", null, 1, Number(e.venue?.setup_fee), Number(e.venue?.setup_fee));
    if (Number(e.discount1_amount) > 0) pushLine(e.discount1_label || "Discount", null, null, null, Number(e.discount1_amount), true);
    if (Number(e.discount2_amount) > 0) pushLine(e.discount2_label || "Discount", null, null, null, Number(e.discount2_amount), true);

    return `<table class="xdoc-table"><thead><tr><th>Services</th><th class="xdoc-qty">Qty</th><th class="xdoc-amount">Unit Price</th><th class="xdoc-amount">Amount</th></tr></thead><tbody>${rows.join(
      "",
    )}</tbody><tfoot><tr><td colspan="3">${esc(totalLabel)}</td><td class="xdoc-amount">${money(b.total)}</td></tr></tfoot></table>`;
  }

  const pkgPrice = Number(e.package_price_override ?? e.package_price_locked ?? e.package?.default_price ?? 0);
  if (e.package) {
    rows.push(
      `<tr><td><strong>${esc(e.package.client_facing_name || e.package.name)}</strong>${descHtml(
        b.pinnedDescription,
        showDescriptions,
      )}</td><td class="xdoc-amount">${money(pkgPrice)}</td></tr>`,
    );
  }
  for (const a of b.addons) {
    const unit = Number(a.price_override ?? a.price_locked ?? a.addon?.default_price ?? 0);
    rows.push(
      `<tr><td>${esc((a.addon?.client_facing_name as string | null) || a.addon?.name || "Add-On")}${
        a.quantity > 1 ? ` × ${a.quantity}` : ""
      }${descHtml((a.description_override || a.addon?.description) as string | null, showDescriptions)}</td><td class="xdoc-amount">${money(
        unit * a.quantity,
      )}</td></tr>`,
    );
  }
  if (Number(e.overtime_fee) > 0) rows.push(`<tr><td>Overtime</td><td class="xdoc-amount">${money(Number(e.overtime_fee))}</td></tr>`);
  if (Number(e.travel_fee) > 0) rows.push(`<tr><td>Travel Fee</td><td class="xdoc-amount">${money(Number(e.travel_fee))}</td></tr>`);
  if (Number(e.venue?.setup_fee ?? 0) > 0)
    rows.push(`<tr><td>Venue Setup Fee</td><td class="xdoc-amount">${money(Number(e.venue?.setup_fee))}</td></tr>`);
  if (Number(e.discount1_amount) > 0)
    rows.push(
      `<tr class="xdoc-discount"><td>${esc(e.discount1_label || "Discount")}</td><td class="xdoc-amount">−${money(
        Number(e.discount1_amount),
      )}</td></tr>`,
    );
  if (Number(e.discount2_amount) > 0)
    rows.push(
      `<tr class="xdoc-discount"><td>${esc(e.discount2_label || "Discount")}</td><td class="xdoc-amount">−${money(
        Number(e.discount2_amount),
      )}</td></tr>`,
    );

  return `<table class="xdoc-table"><thead><tr><th>Services</th><th class="xdoc-amount">Investment</th></tr></thead><tbody>${rows.join(
    "",
  )}</tbody><tfoot><tr><td>${esc(totalLabel)}</td><td class="xdoc-amount">${money(b.total)}</td></tr></tfoot></table>`;
}

export function renderPaymentSchedule(b: EventBundle, options?: DocBlockOptions): string {
  if (b.financialsHidden) return "";
  if (options?.hideWhenPaidInFull && balanceDue(b.total, b.payments) <= 0) return "";

  let rows = b.schedule;
  if (options?.onlyUnpaid) {
    const approved = b.payments
      .filter((p) => (p.status ?? "approved") === "approved" && !p.deletedAt)
      .map((p) => ({ amount: Number(p.amount || 0), scheduled_payment_id: p.scheduledPaymentId ?? null }));
    const { open } = splitSchedule(b.schedule, approved);
    rows = open;
    if (rows.length === 0) {
      return `<p class="xdoc-muted">No upcoming payments.</p>`;
    }
  }

  if (rows.length === 0) {
    return `<p class="xdoc-muted">Payment schedule to be determined.</p>`;
  }
  const body = rows
    .map(
      (sp) =>
        `<tr><td>${esc(sp.label || (sp.seq === 1 ? "Retainer" : `Payment ${sp.seq}`))}</td><td>${
          sp.due_date ? fmtDate(sp.due_date) : "TBD"
        }</td><td class="xdoc-amount">${money(Number(sp.amount))}</td></tr>`,
    )
    .join("");
  return `<table class="xdoc-table"><thead><tr><th>Payment</th><th>Due</th><th class="xdoc-amount">Amount</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** Actual received payments table + paid to date / remaining balance.
    processing_fee is display-only and never counted toward paid/balance.
    Notes column is OFF by default; when on, imported DJEP notes are stripped. */
export function renderPaymentsReceived(b: EventBundle, options?: DocBlockOptions): string {
  if (b.financialsHidden) return "";
  const showNotes = options?.showNotes === true;
  const live = b.payments.filter((p) => (p.status ?? "approved") === "approved" && !p.deletedAt);
  if (live.length === 0) {
    return `<p class="xdoc-muted">No payments recorded yet.</p>`;
  }
  const rows = live
    .map((p) => {
      const fee = Number(p.processingFee ?? 0);
      const feeLine = fee > 0 ? `<div class="xdoc-desc">Card service fee: ${money(fee)} (not applied to balance)</div>` : "";
      const noteCell = showNotes ? `<td>${esc(clientFacingPaymentNotes(p))}</td>` : "";
      return `<tr><td>${esc(formatPaymentDate(p.paidAt))}</td><td>${esc(formatPaymentMethod(p.method))}${feeLine}</td>${noteCell}<td class="xdoc-amount">${money(
        Number(p.amount || 0),
      )}</td></tr>`;
    })
    .join("");
  const paid = totalPaid(live);
  const remaining = balanceStatus(b.total, live);
  const notesHead = showNotes ? "<th>Notes</th>" : "";
  const span = showNotes ? 3 : 2;
  return `<table class="xdoc-table"><thead><tr><th>Date</th><th>Method</th>${notesHead}<th class="xdoc-amount">Amount</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="${span}">Paid to date</td><td class="xdoc-amount">${money(
    paid,
  )}</td></tr><tr><td colspan="${span}">Remaining balance</td><td class="xdoc-amount">${esc(remaining)}</td></tr></tfoot></table>`;
}

/** Highlighted summary: total investment, already paid, balance due / paid in full. */
export function renderSummaryBox(b: EventBundle, options?: DocBlockOptions): string {
  if (b.financialsHidden) return "";
  const totalLabel = (options?.totalLabel ?? "").trim() || DEFAULT_SUMMARY_TOTAL_LABEL;
  const paidLabel = (options?.paidLabel ?? "").trim() || DEFAULT_SUMMARY_PAID_LABEL;
  const balanceLabel = (options?.balanceLabel ?? "").trim() || DEFAULT_SUMMARY_BALANCE_LABEL;
  const paidInFullLabel = (options?.paidInFullLabel ?? "").trim() || DEFAULT_SUMMARY_PAID_IN_FULL_LABEL;
  const paid = totalPaid(b.payments);
  const bal = balanceDue(b.total, b.payments);
  const balanceValue = bal <= 0 ? paidInFullLabel : money(bal);
  const balanceClass = bal <= 0 ? "xdoc-summary-paid" : "xdoc-summary-due";
  return `<div class="xdoc-summary"><div class="xdoc-summary-row"><span>${esc(totalLabel)}</span><span class="xdoc-amount">${money(
    b.total,
  )}</span></div><div class="xdoc-summary-row"><span>${esc(paidLabel)}</span><span class="xdoc-amount">${money(
    paid,
  )}</span></div><div class="xdoc-summary-row ${balanceClass}"><span>${esc(
    bal <= 0 ? paidInFullLabel : balanceLabel,
  )}</span><span class="xdoc-amount">${esc(balanceValue)}</span></div></div>`;
}

export function renderEventDetails(b: EventBundle): string {
  const e = b.event;
  const venueLine = e.venue
    ? `${esc(e.venue.name)}${e.venue.address ? ` - ${esc(e.venue.address)}` : ""}${e.venue.city ? `, ${esc(e.venue.city)}` : ""}${
        e.venue.state ? `, ${esc(e.venue.state)}` : ""
      }`
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
  status: string = "draft",
): Promise<{ id: string; title: string; access_token: string; doc_type: string } | null> {
  const [{ data: template }, { data: event }] = await Promise.all([
    supabase.from("document_templates").select("*").eq("id", templateId).single(),
    supabase.from("events").select("id, name, client:clients(first_name, last_name)").eq("id", eventId).single(),
  ]);
  if (!template || !event) return null;

  const rendered = await renderBlocks(supabase, eventId, sanitizeBlocks(template.blocks));
  if (!rendered) return null;

  const client = event.client as unknown as { first_name: string; last_name: string } | null;
  const clientName = client ? `${client.first_name} ${client.last_name}`.trim() : "";
  const title = formatDocumentTitle((template as { title_format?: string | null }).title_format, {
    template: template.name,
    client: clientName,
    event: event.name || "",
  });
  const headerKicker =
    ((template as { header_kicker?: string | null }).header_kicker ?? "").trim() || defaultHeaderKicker(template.doc_type);

  const { data: doc, error } = await supabase
    .from("documents")
    .insert({
      template_id: templateId,
      event_id: eventId,
      title,
      doc_type: template.doc_type,
      header_kicker: headerKicker,
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

export async function renderBlocks(supabase: SupabaseClient, eventId: string, blocks: DocBlock[]): Promise<DocBlock[] | null> {
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
      out.push({ ...block, html: renderFeeTable(bundle, block.options) });
    } else if (block.type === "payment_schedule") {
      out.push({ ...block, html: renderPaymentSchedule(bundle, block.options) });
    } else if (block.type === "payments_received") {
      out.push({ ...block, html: renderPaymentsReceived(bundle, block.options) });
    } else if (block.type === "summary_box") {
      out.push({ ...block, html: renderSummaryBox(bundle, block.options) });
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
