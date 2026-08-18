import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatComplete, isOpenAIConfigured } from "@/lib/openai";

/* Event intelligence: gather everything known about one event (basics, staff,
   package/add-ons, the planner timeline + songs + Q&A, Fireflies call notes/transcript,
   internal notes) into a text context, then use OpenAI to (a) write a staff briefing
   and (b) answer questions grounded in that data. Server-only. */

const clamp = (s: string | null | undefined, n: number) =>
  s && s.length > n ? s.slice(0, n) + " …[truncated]" : s || "";

type Row = Record<string, unknown>;
const pick = (r: unknown, k: string) => (r as Row | null)?.[k];
const nameOf = (e: unknown) => {
  const x = e as { first_name?: string; last_name?: string; stage_name?: string } | null;
  return x ? x.stage_name || [x.first_name, x.last_name].filter(Boolean).join(" ") : "";
};

export async function buildEventContext(sb: SupabaseClient, eventId: string): Promise<string> {
  const { data: e } = await sb
    .from("events")
    .select(
      `name, event_date, setup_time, start_time, end_time, guest_count, internal_notes, planning_seeded, custom_fields,
       event_type:event_types(name), status:event_statuses(name), venue:venues(name,address,city),
       package:packages(name), salesperson:employees(first_name,last_name,stage_name)`,
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!e) return "";

  const [{ data: ecs }, { data: staff }, { data: addons }, { data: secs }, { data: songs }, { data: qs }, { data: ans }, { data: ff }, { data: notes }] =
    await Promise.all([
      sb.from("event_clients").select("role,is_primary,client:clients(first_name,last_name,email,cell_phone)").eq("event_id", eventId),
      sb.from("event_staff").select("role,employee:employees(first_name,last_name,stage_name)").eq("event_id", eventId),
      sb.from("event_addons").select("quantity,addon:addons(name)").eq("event_id", eventId),
      sb.from("planning_sections").select("id,title,time_label,section_type,intro,sort_order").eq("event_id", eventId).order("sort_order"),
      sb.from("planning_songs").select("section_id,title,artist,note,must_play,do_not_play,sort_order").eq("event_id", eventId).order("sort_order"),
      sb.from("planning_questions").select("id,section_id,prompt").eq("event_id", eventId),
      sb.from("planning_question_answers").select("question_id,answer").eq("event_id", eventId),
      sb.from("fireflies_meetings").select("title,meeting_date,summary_overview,action_items_raw,transcript_text").eq("event_id", eventId).order("meeting_date", { ascending: false }),
      sb.from("event_notes").select("body,created_at").eq("event_id", eventId).order("created_at"),
    ]);

  const L: string[] = [];
  L.push(`# EVENT: ${pick(e, "name") ?? "(unnamed)"}`);
  L.push(`Date: ${pick(e, "event_date") ?? "?"} · Setup ${pick(e, "setup_time") ?? "?"} · Start ${pick(e, "start_time") ?? "?"} · End ${pick(e, "end_time") ?? "?"}`);
  L.push(`Type: ${nameField(e, "event_type")} · Status: ${nameField(e, "status")} · Guests: ${pick(e, "guest_count") ?? "?"}`);
  const v = pick(e, "venue") as { name?: string; address?: string; city?: string } | null;
  L.push(`Venue: ${v?.name ?? "?"}${v?.city ? ` (${v.city})` : ""}`);
  L.push(`Package: ${nameField(e, "package")}`);
  L.push(`Salesperson: ${nameOf(pick(e, "salesperson")) || "?"}`);

  const clients = (ecs ?? []).map((c) => `${nameOf(pick(c, "client"))}${pick(c, "role") ? ` (${pick(c, "role")})` : ""}`).filter(Boolean);
  if (clients.length) L.push(`Clients: ${clients.join(", ")}`);

  const staffList = (staff ?? []).map((s) => `${nameOf(pick(s, "employee"))} — ${pick(s, "role") ?? "Staff"}`).filter((x) => x.trim() !== "— Staff");
  L.push(`\n## STAFF WORKING\n${staffList.length ? staffList.map((s) => `- ${s}`).join("\n") : "- (none assigned)"}`);

  const addonList = (addons ?? []).map((a) => `${(pick(a, "addon") as { name?: string })?.name ?? "Add-on"}${(pick(a, "quantity") as number) > 1 ? ` ×${pick(a, "quantity")}` : ""}`);
  if (addonList.length) L.push(`\n## ADD-ONS\n${addonList.map((a) => `- ${a}`).join("\n")}`);

  // Planner timeline
  if (pick(e, "planning_seeded")) {
    const ansByQ = new Map((ans ?? []).map((a) => [pick(a, "question_id") as string, pick(a, "answer") as string]));
    const qById = new Map((qs ?? []).map((q) => [pick(q, "id") as string, q]));
    const songsBySec = new Map<string, Row[]>();
    for (const s of songs ?? []) {
      const sid = pick(s, "section_id") as string;
      const arr = songsBySec.get(sid) ?? [];
      arr.push(s as Row);
      songsBySec.set(sid, arr);
    }
    const qBySec = new Map<string, Row[]>();
    for (const q of qs ?? []) {
      const sid = pick(q, "section_id") as string;
      const arr = qBySec.get(sid) ?? [];
      arr.push(q as Row);
      qBySec.set(sid, arr);
    }
    L.push(`\n## PLANNER TIMELINE (XOS)`);
    for (const sec of secs ?? []) {
      const sid = pick(sec, "id") as string;
      L.push(`\n### ${pick(sec, "time_label") ? `[${pick(sec, "time_label")}] ` : ""}${pick(sec, "title") ?? "Section"}`);
      if (pick(sec, "intro")) L.push(`${clamp(pick(sec, "intro") as string, 400)}`);
      for (const q of qBySec.get(sid) ?? []) {
        const a = ansByQ.get(pick(q, "id") as string);
        if (a && a.trim()) L.push(`- ${pick(q, "prompt")}: ${a}`);
      }
      for (const s of songsBySec.get(sid) ?? []) {
        const tags = [pick(s, "must_play") ? "MUST-PLAY" : "", pick(s, "do_not_play") ? "DO-NOT-PLAY" : ""].filter(Boolean).join("/");
        L.push(`- ♪ ${pick(s, "title")}${pick(s, "artist") ? ` — ${pick(s, "artist")}` : ""}${tags ? ` [${tags}]` : ""}${pick(s, "note") ? ` (${pick(s, "note")})` : ""}`);
      }
    }
    // unattached answers (questions with no section match)
    void qById;
  } else if ((pick(e, "custom_fields") as Record<string, unknown>)?.vibo_link) {
    L.push(`\n## PLANNER: Vibo (legacy). Vibo link: ${(pick(e, "custom_fields") as Record<string, string>).vibo_link}. Timeline/music live in Vibo (or an uploaded PDF) — not in XOS.`);
  } else {
    L.push(`\n## PLANNER: not started.`);
  }

  // Fireflies calls
  if ((ff ?? []).length) {
    L.push(`\n## CALL NOTES (Fireflies)`);
    for (const m of (ff ?? []).slice(0, 2)) {
      L.push(`\n### Call: ${pick(m, "title") ?? "Untitled"} (${pick(m, "meeting_date") ?? ""})`);
      if (pick(m, "summary_overview")) L.push(`Summary: ${clamp(pick(m, "summary_overview") as string, 1500)}`);
      if (pick(m, "action_items_raw")) L.push(`Action items:\n${clamp(pick(m, "action_items_raw") as string, 1500)}`);
      if (pick(m, "transcript_text")) L.push(`Transcript excerpt:\n${clamp(pick(m, "transcript_text") as string, 5000)}`);
    }
  }

  // Notes
  const noteLines = (notes ?? []).map((n) => `- ${pick(n, "body")}`).filter((x) => x !== "- ");
  if (pick(e, "internal_notes")) noteLines.unshift(`- ${pick(e, "internal_notes")}`);
  if (noteLines.length) L.push(`\n## INTERNAL NOTES\n${noteLines.join("\n")}`);

  return L.join("\n");
}

function nameField(e: unknown, key: string): string {
  const x = (e as Row)?.[key] as { name?: string } | null;
  return x?.name ?? "?";
}

export async function summarizeEvent(sb: SupabaseClient, eventId: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!isOpenAIConfigured()) return { ok: false, error: "OpenAI isn't configured (OPENAI_API_KEY missing)." };
  const ctx = await buildEventContext(sb, eventId);
  if (!ctx) return { ok: false, error: "Event not found." };
  const system =
    "You are the operations assistant for Xpress Entertainment, a DJ/event company. Using ONLY the event data provided, write a tight, skimmable briefing for the DJ and on-site staff working THIS event. Cover, with short markdown headers + bullets: the essentials (date, setup/start/end times, venue, guest count), who's working, the package & add-ons, the timeline flow with key music moments (grand entrance, first dance, parent dances, etc.), any must-plays / do-not-plays / special requests, and end with a short **CONFIRM BEFORE THE EVENT** list of anything unclear, TBD, or flagged on the call. Be concrete and executable. Do not invent details.";
  try {
    const text = await chatComplete([{ role: "system", content: system }, { role: "user", content: ctx }]);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI request failed." };
  }
}

export async function answerEventQuestion(sb: SupabaseClient, eventId: string, question: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!isOpenAIConfigured()) return { ok: false, error: "OpenAI isn't configured (OPENAI_API_KEY missing)." };
  const ctx = await buildEventContext(sb, eventId);
  if (!ctx) return { ok: false, error: "Event not found." };
  const system = `You answer questions about ONE specific event for the staff of a DJ/event company, using ONLY the event data below. If the answer isn't in the data, say you don't have that on file (never guess). Be concise and specific — quote song titles, times, and names exactly.\n\n=== EVENT DATA ===\n${ctx}`;
  try {
    const text = await chatComplete([{ role: "system", content: system }, { role: "user", content: question }]);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI request failed." };
  }
}
