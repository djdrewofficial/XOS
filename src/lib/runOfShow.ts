import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlToPdf } from "@/lib/pdf";
import { sendBrandedEmail } from "@/lib/mailgun";

/* Run-of-Show helpers. Generation is ASYNC (Netlify serverless caps sync requests at
   ~26s, but OpenAI synthesis + PDF render is longer): the start route builds the event
   context and triggers a background function that does the OpenAI call, then hands the
   HTML to the finalize route which renders the branded PDF here (chromium works in
   Next), saves it to Docs, and emails staff. Drew's exact spec is the SYSTEM prompt.
   Vibo PDF text isn't parsed yet — for Vibo events the doc builds from transcript/notes
   and flags to confirm music against the attached Vibo PDF. */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const RUN_OF_SHOW_SYSTEM = `Generate a wedding run of show for Xpress Entertainment from three inputs: a Vibo export, a planner timeline, and a Fireflies call transcript. Treat Vibo as source of truth for music, names, and couple-written notes; the planner timeline as source of truth for clock times, sequence, and vendor responsibilities; and the transcript as source of truth for decisions made live on the call, overriding both documents when they conflict because it is the most recent input. Filter every beat down to what Xpress or the MC actually does, keeping other vendors only where they are a dependency. Build the timeline on the planner's clock, attach Vibo songs and notes to matching beats, then apply transcript decisions as amendments. Do not silently pick a winner when sources disagree: resolve only same-thing-different-name cases, and surface everything else as a numbered CRITICAL FLAGS block at the top of the document, covering same-field-different-value conflicts, direct contradictions, and stale-versus-updated fields, each stating exactly what to confirm and who to confirm it with. Promote every pre-event prep item out of the timeline into that flags block, including custom edits, mashups, short versions, cue points, and anything still marked TBD. Render as a flags block, then chronological phase sections with time/beat/music-cue rows, then reference appendices for playlists, MC name pronunciations, and music rules. Write for someone standing behind a booth mid-event: every cue must be executable without opening a second document.

The three inputs are provided below as labeled sections of the EVENT DATA: the "PLANNER TIMELINE (XOS)" section is the planner timeline; the "CALL NOTES (Fireflies)" transcript is the call transcript; Vibo music/notes appear either inline in the planner songs or, for legacy events, are noted as living in Vibo/an attached PDF (if the Vibo export text isn't present, build from the planner + transcript and FLAG that the Vibo music list must be confirmed against the attached Vibo PDF). If a source is missing, work from what's available and flag the gap.

OUTPUT FORMAT: return clean semantic HTML only — use <h2>, <h3>, <p>, <ol>, <ul>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <strong>, <em>. NO <html>/<head>/<body>/<style>/<script> tags, no markdown fences. Start with an <h2>CRITICAL FLAGS</h2> followed by a numbered <ol>. Then one <h2> per chronological phase, each with a <table> whose columns are Time | Beat | Music / Cue. End with <h2>Appendix</h2> sections for playlists, MC name pronunciations, and music rules.`;

/** Render the AI's run-of-show HTML body into a branded PDF. Text-only header (no
    remote logo) so the renderer never waits on a network image. */
export async function renderRunOfShowPdf(
  sb: SupabaseClient,
  bodyHtml: string,
  eventName: string,
  eventDate: string | null,
): Promise<Buffer> {
  const { data: cs } = await sb.from("company_settings").select("company_name").eq("id", true).maybeSingle();
  const company = (cs?.company_name as string) ?? "Xpress Entertainment";
  let clean = bodyHtml.replace(/^```html?/i, "").replace(/```$/i, "").trim();
  clean = clean.replace(/<img[^>]*>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0.5in; }
    body { font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif; color:#111; font-size:11px; margin:0; line-height:1.35; }
    header { border-bottom:2px solid #111; padding-bottom:8px; margin-bottom:14px; }
    .co { font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:#555; }
    .title { font-size:18px; font-weight:800; margin:2px 0 0; } .sub { color:#555; font-size:11px; }
    h2 { font-size:13px; margin:16px 0 6px; border-bottom:1px solid #bbb; padding-bottom:2px; text-transform:uppercase; letter-spacing:0.03em; }
    h3 { font-size:12px; margin:10px 0 4px; }
    table { width:100%; border-collapse:collapse; margin:6px 0; } th,td { border:1px solid #ccc; padding:4px 6px; text-align:left; vertical-align:top; } th { background:#eee; font-size:10px; text-transform:uppercase; }
    ol,ul { margin:6px 0 6px 18px; } li { margin:3px 0; }
  </style></head><body>
    <header><div class="co">${esc(company)}</div><div class="title">${esc(eventName)} — Run of Show</div>${eventDate ? `<div class="sub">Event date: ${esc(eventDate)}</div>` : ""}</header>
    ${clean}
  </body></html>`;
  return htmlToPdf(html);
}

/** Save the PDF into the event's Docs (event-files, staff-only). Returns the file id. */
export async function saveRunOfShowToDocs(admin: SupabaseClient, eventId: string, pdf: Buffer, filename: string): Promise<string | null> {
  const path = `${eventId}/${crypto.randomUUID()}.pdf`;
  const { error: up } = await admin.storage.from("event-files").upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (up) return null;
  const { data } = await admin
    .from("event_files")
    .insert({ event_id: eventId, name: filename, path, content_type: "application/pdf", size_bytes: pdf.length, source: "generated" })
    .select("id")
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/** Email the run-of-show PDF to the event's assigned staff. Returns count sent. */
export async function emailRunOfShowToStaff(admin: SupabaseClient, eventId: string, pdf: Buffer, filename: string, eventName: string): Promise<number> {
  const { data: ev } = await admin.from("events").select("event_date").eq("id", eventId).maybeSingle();
  const { data: staff } = await admin.from("event_staff").select("employee:employees(first_name,email)").eq("event_id", eventId);
  const seen = new Set<string>();
  let sent = 0;
  for (const s of staff ?? []) {
    const emp = s.employee as unknown as { first_name?: string; email?: string } | null;
    const to = emp?.email?.trim();
    if (!to || seen.has(to.toLowerCase())) continue;
    seen.add(to.toLowerCase());
    const res = await sendBrandedEmail({
      to,
      subject: `Run of Show — ${eventName}`,
      contentHtml: `<p>Hi ${esc(emp?.first_name || "there")},</p><p>Attached is the run of show for <strong>${esc(eventName)}</strong>${ev?.event_date ? ` (${esc(String(ev.event_date))})` : ""}. Everything you need for the night is in the PDF — check the <strong>CRITICAL FLAGS</strong> at the top first.</p><p>— Xpress Entertainment</p>`,
      attachments: [{ filename, data: pdf, contentType: "application/pdf" }],
      supabase: admin,
    });
    if (res.ok) sent++;
  }
  return sent;
}

export function runOfShowFilename(eventName: string): string {
  return `Run of Show — ${eventName.replace(/[^\w &'-]/g, "").slice(0, 60)}.pdf`;
}
