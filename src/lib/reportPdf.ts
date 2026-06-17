import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlToPdf } from "@/lib/pdf";
import { appUrl } from "@/lib/signing";

/* A normalized report model rendered into a branded, black-&-white PDF (so the
   same numbers shown on screen export cleanly). */

export type ReportColumn = { label: string; align?: "left" | "right" };
export type ReportTable = { caption?: string; columns: ReportColumn[]; rows: string[][]; foot?: string[] };
export type ReportDoc = {
  title: string;
  subtitle?: string;
  meta?: string[];
  stats?: { label: string; value: string }[];
  tables: ReportTable[];
};

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cls = (c?: ReportColumn) => (c?.align === "right" ? "r" : "l");

function tableHtml(t: ReportTable): string {
  return `${t.caption ? `<h2 class="cap">${esc(t.caption)}</h2>` : ""}
  <table>
    <thead><tr>${t.columns.map((c) => `<th class="${cls(c)}">${esc(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${t.rows
      .map((r) => `<tr>${r.map((cell, i) => `<td class="${cls(t.columns[i])}">${esc(cell)}</td>`).join("")}</tr>`)
      .join("")}</tbody>
    ${t.foot ? `<tfoot><tr>${t.foot.map((cell, i) => `<td class="${cls(t.columns[i])}">${esc(cell)}</td>`).join("")}</tr></tfoot>` : ""}
  </table>`;
}

export async function renderReportPdf(supabase: SupabaseClient, doc: ReportDoc): Promise<Buffer> {
  const { data: cs } = await supabase.from("company_settings").select("company_name").eq("id", true).maybeSingle();
  const company = (cs?.company_name as string) ?? "Xpress Entertainment";
  const generated = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  const stats = doc.stats?.length
    ? `<div class="stats">${doc.stats
        .map((s) => `<div class="stat"><div class="sl">${esc(s.label)}</div><div class="sv">${esc(s.value)}</div></div>`)
        .join("")}</div>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    @page { margin: 0.5in; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; font-size: 11px; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
    .head img { height: 44px; filter: grayscale(100%); }
    .head .meta { text-align: right; font-size: 10px; color: #555; }
    .head .co { font-size: 12px; font-weight: 700; color: #111; }
    h1 { font-size: 18px; margin: 0 0 2px; }
    .sub { color: #555; font-size: 11px; margin-bottom: 10px; }
    .stats { display: flex; gap: 8px; margin: 12px 0 16px; }
    .stat { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; text-align: center; }
    .sl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; color: #666; }
    .sv { font-size: 15px; font-weight: 800; }
    h2.cap { font-size: 12px; margin: 18px 0 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th, td { padding: 4px 6px; border-bottom: 1px solid #ddd; white-space: nowrap; }
    th { text-transform: uppercase; font-size: 8.5px; letter-spacing: .04em; color: #444; border-bottom: 1.5px solid #111; text-align: left; }
    th.r, td.r { text-align: right; }
    td.l { white-space: normal; }
    tbody tr:nth-child(even) { background: #f4f4f4; }
    tfoot td { font-weight: 800; border-top: 1.5px solid #111; border-bottom: none; background: #eaeaea; background: #eaeaea; }
    .ftr { margin-top: 18px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
  </style></head><body>
    <div class="head">
      <img src="${appUrl()}/logo-dark.png" alt="${esc(company)}" />
      <div class="meta"><div class="co">${esc(company)}</div><div>Generated ${esc(generated)}</div></div>
    </div>
    <h1>${esc(doc.title)}</h1>
    ${doc.subtitle ? `<div class="sub">${esc(doc.subtitle)}</div>` : ""}
    ${doc.meta?.length ? `<div class="sub">${doc.meta.map(esc).join(" &middot; ")}</div>` : ""}
    ${stats}
    ${doc.tables.map(tableHtml).join("")}
    <div class="ftr"><span>${esc(company)}</span><span>${esc(doc.title)}</span></div>
  </body></html>`;

  return htmlToPdf(html);
}
