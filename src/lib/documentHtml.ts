import type { SupabaseClient } from "@supabase/supabase-js";
import { XDOC_CSS } from "@/components/DocumentShell";
import { sanitizeBlocks, docTypeClientLabel } from "@/lib/documentBlocks";
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

  // PDFs print fully expanded: force every chapter <details> open
  const body = blocks
    .map((b) => `<div class="xdoc-block">${(b.html ?? "").replace(/<details class="xdoc-sec">/g, '<details class="xdoc-sec" open>')}</div>`)
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>${XDOC_CSS}
  /* PDF: flatten chaprome like the print stylesheet */
  .xdoc { box-shadow: none; border-radius: 0; max-width: none; }
  .xdoc-sec { border: none; border-radius: 0; }
  .xdoc-sec summary { background: none; padding: 8px 0 2px; }
  .xdoc-sec summary::before { display: none; }
  .xdoc-sec-body { padding: 4px 0 10px; }
  .xdoc-table, .xdoc-details, .xdoc-sign, .xdoc-detail, .xdoc-table tr { break-inside: avoid; page-break-inside: avoid; }
  </style></head><body style="margin:0;background:#fff;">
  <div class="xdoc">
    <header class="xdoc-header">
      <img src="${appUrl()}/logo-dark.png" alt="${esc(companyName)}" />
      <div class="xdoc-kind">${esc(docTypeClientLabel(doc.doc_type))}</div>
      <div class="xdoc-title">${esc(doc.title)}</div>
      <div class="xdoc-sub">${esc(sub)}</div>
    </header>
    <div class="xdoc-body">${body}</div>
    <footer class="xdoc-footer"><span>${esc(companyName)}</span><span>${signedLine}</span></footer>
  </div>
  </body></html>`;
  return { html, title: doc.title };
}
