import type { SupabaseClient } from "@supabase/supabase-js";
import { XDOC_CSS } from "@/components/DocumentShell";
import { sanitizeBlocks, docTypeClientLabel } from "@/lib/documentBlocks";
import { renderBlocks } from "@/lib/documentRender";
import { appUrl } from "@/lib/signing";

/* Renders a generated document into a complete standalone HTML page for the
   PDF engine — same markup/CSS as the DocumentShell component (plain template
   strings: react-dom/server isn't allowed in route code). */

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export async function buildDocumentHtml(
  supabase: SupabaseClient,
  documentId: string
): Promise<{ html: string; title: string } | null> {
  const [{ data: doc }, { data: cs }] = await Promise.all([
    supabase
      .from("documents")
      .select("*, event:events(id, name, event_date, client:clients(first_name, last_name))")
      .eq("id", documentId)
      .single(),
    supabase.from("company_settings").select("company_name, from_email").eq("id", true).maybeSingle(),
  ]);
  if (!doc) return null;

  const ev = doc.event as unknown as {
    name: string;
    event_date: string | null;
    client: { first_name: string; last_name: string } | null;
  } | null;
  const clientName = ev?.client ? `${ev.client.first_name} ${ev.client.last_name}`.trim() : null;
  const companyName = cs?.company_name ?? "Xpress Entertainment";
  const blocks = sanitizeBlocks(doc.blocks);
  const sub = [clientName, fmtDate(ev?.event_date)].filter(Boolean).join(" · ");
  const signedLine = doc.signed_at
    ? `Signed by ${esc(doc.signer_name)} on ${new Date(doc.signed_at).toLocaleString()}`
    : esc(cs?.from_email ?? "");

  return {
    html: wrapDocHtml({ companyName, docType: doc.doc_type, title: doc.title, sub, signedLine, blocks }),
    title: doc.title,
  };
}

/** Wrap rendered blocks in the branded standalone HTML page (PDF / preview). */
function wrapDocHtml(opts: {
  companyName: string;
  docType: string;
  title: string;
  sub: string;
  signedLine: string;
  blocks: { html?: string | null }[];
}): string {
  const body = opts.blocks
    .map((b) => `<div class="xdoc-block">${(b.html ?? "").replace(/<details class="xdoc-sec">/g, '<details class="xdoc-sec" open>')}</div>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>${XDOC_CSS}
  .xdoc { box-shadow: none; border-radius: 0; max-width: 820px; margin: 24px auto; }
  .xdoc-sec { border: none; border-radius: 0; }
  .xdoc-sec summary { background: none; padding: 8px 0 2px; }
  .xdoc-sec summary::before { display: none; }
  .xdoc-sec-body { padding: 4px 0 10px; }
  .xdoc-table, .xdoc-details, .xdoc-sign, .xdoc-detail, .xdoc-table tr { break-inside: avoid; page-break-inside: avoid; }
  </style></head><body style="margin:0;background:#f4f4f7;">
  <div class="xdoc">
    <header class="xdoc-header">
      <img src="${appUrl()}/logo-dark.png" alt="${esc(opts.companyName)}" />
      <div class="xdoc-kind">${esc(docTypeClientLabel(opts.docType))}</div>
      <div class="xdoc-title">${esc(opts.title)}</div>
      <div class="xdoc-sub">${esc(opts.sub)}</div>
    </header>
    <div class="xdoc-body">${body}</div>
    <footer class="xdoc-footer"><span>${esc(opts.companyName)}</span><span>${opts.signedLine}</span></footer>
  </div>
  </body></html>`;
}

/** Preview a TEMPLATE (no saved document) by rendering its blocks against a
    sample event so merge tags + smart blocks fill in. Falls back to raw blocks
    if no sample event exists. */
export async function buildTemplatePreviewHtml(
  supabase: SupabaseClient,
  templateId: string,
): Promise<{ html: string; title: string } | null> {
  const [{ data: tpl }, { data: cs }] = await Promise.all([
    supabase.from("document_templates").select("name, doc_type, blocks").eq("id", templateId).single(),
    supabase.from("company_settings").select("company_name, from_email, default_template_event_id").eq("id", true).maybeSingle(),
  ]);
  if (!tpl) return null;

  const companyName = cs?.company_name ?? "Xpress Entertainment";
  let eventId = (cs?.default_template_event_id as string | null) ?? null;
  if (!eventId) {
    const { data: latest } = await supabase
      .from("events")
      .select("id")
      .not("client_id", "is", null)
      .order("event_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    eventId = latest?.id ?? null;
  }

  let blocks = sanitizeBlocks(tpl.blocks);
  let sub = "PREVIEW — no sample event found (merge tags shown raw)";
  if (eventId) {
    const { data: ev } = await supabase
      .from("events")
      .select("name, event_date, client:clients(first_name, last_name)")
      .eq("id", eventId)
      .maybeSingle();
    const rendered = await renderBlocks(supabase, eventId, blocks);
    if (rendered) blocks = rendered;
    const client = (ev as unknown as { client: { first_name: string; last_name: string } | null } | null)?.client;
    const clientName = client ? `${client.first_name} ${client.last_name}`.trim() : null;
    sub = ["PREVIEW", clientName, fmtDate((ev as { event_date?: string | null } | null)?.event_date)].filter(Boolean).join(" · ");
  }

  return {
    html: wrapDocHtml({ companyName, docType: tpl.doc_type, title: tpl.name, sub, signedLine: esc(cs?.from_email ?? ""), blocks }),
    title: tpl.name,
  };
}
