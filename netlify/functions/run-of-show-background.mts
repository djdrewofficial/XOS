import type { Config } from "@netlify/functions";

/* Background function (15-min limit) for run-of-show generation. The sync API request
   caps at ~26s, but the OpenAI synthesis is longer — so the /api/events/[id]/run-of-show
   POST triggers this with the pre-built event context. This does ONLY the OpenAI call
   (no heavy deps here), then hands the HTML to /api/cron/run-of-show-finalize which
   renders the PDF (chromium lives in Next), saves it, and emails staff. Protected by
   the CRON_SECRET bearer. */

const SYSTEM = `Generate a wedding run of show for Xpress Entertainment from three inputs: a Vibo export, a planner timeline, and a Fireflies call transcript. Treat Vibo as source of truth for music, names, and couple-written notes; the planner timeline as source of truth for clock times, sequence, and vendor responsibilities; and the transcript as source of truth for decisions made live on the call, overriding both documents when they conflict because it is the most recent input. Filter every beat down to what Xpress or the MC actually does, keeping other vendors only where they are a dependency. Build the timeline on the planner's clock, attach Vibo songs and notes to matching beats, then apply transcript decisions as amendments. Do not silently pick a winner when sources disagree: resolve only same-thing-different-name cases, and surface everything else as a numbered CRITICAL FLAGS block at the top of the document, covering same-field-different-value conflicts, direct contradictions, and stale-versus-updated fields, each stating exactly what to confirm and who to confirm it with. Promote every pre-event prep item out of the timeline into that flags block, including custom edits, mashups, short versions, cue points, and anything still marked TBD. Render as a flags block, then chronological phase sections with time/beat/music-cue rows, then reference appendices for playlists, MC name pronunciations, and music rules. Write for someone standing behind a booth mid-event: every cue must be executable without opening a second document.

The three inputs are provided below as labeled sections of the EVENT DATA: the "PLANNER TIMELINE (XOS)" section is the planner timeline; the "CALL NOTES (Fireflies)" transcript is the call transcript; Vibo music/notes appear either inline in the planner songs or, for legacy events, are noted as living in Vibo/an attached PDF (if the Vibo export text isn't present, build from the planner + transcript and FLAG that the Vibo music list must be confirmed against the attached Vibo PDF). If a source is missing, work from what's available and flag the gap.

OUTPUT FORMAT: return clean semantic HTML only — use <h2>, <h3>, <p>, <ol>, <ul>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <strong>, <em>. NO <html>/<head>/<body>/<style>/<script> tags, no markdown fences. Start with an <h2>CRITICAL FLAGS</h2> followed by a numbered <ol>. Then one <h2> per chronological phase, each with a <table> whose columns are Time | Beat | Music / Cue. End with <h2>Appendix</h2> sections for playlists, MC name pronunciations, and music rules.`;

export default async (req: Request) => {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL ?? "https://xos.xpressdjs.com";
  let payload: { jobId?: string; eventId?: string; context?: string; eventName?: string; eventDate?: string | null; emailStaff?: boolean };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad body", { status: 400 });
  }
  const { jobId, eventId, context, eventName, eventDate, emailStaff } = payload;

  const finalize = (data: Record<string, unknown>) =>
    fetch(`${base}/api/cron/run-of-show-finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({ jobId, eventId, eventName, eventDate, emailStaff, ...data }),
    }).catch(() => {});

  try {
    const model = process.env.OPENAI_MODEL || "gpt-5.5";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `=== EVENT DATA ===\n${context ?? ""}` }] }),
    });
    if (!res.ok) {
      await finalize({ error: `OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}` });
      return new Response("ok");
    }
    const data = await res.json();
    const html = data?.choices?.[0]?.message?.content ?? "";
    if (!html) {
      await finalize({ error: "Empty response from the AI." });
      return new Response("ok");
    }
    await finalize({ html });
  } catch (e) {
    await finalize({ error: e instanceof Error ? e.message : "Generation failed." });
  }
  return new Response("ok");
};

export const config: Config = {};
