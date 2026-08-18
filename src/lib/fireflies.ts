import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/* Fireflies.ai integration. Talks to the Fireflies GraphQL API with FIREFLIES_API_KEY,
   imports call notes/transcripts into fireflies_meetings, matches each to a client/event
   by participant email, and parses the action-items blob into SUGGESTED tasks (a person
   approves them later). Server-only — never import into client code. */

const ENDPOINT = "https://api.fireflies.ai/graphql";
const COMPANY_DOMAIN = "xpressdjs.com";

export function firefliesConfigured(): boolean {
  return !!process.env.FIREFLIES_API_KEY;
}

async function ffQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key) throw new Error("FIREFLIES_API_KEY is not set.");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Fireflies: ${json.errors.map((e) => e.message).join("; ")}`);
  if (!json.data) throw new Error(`Fireflies: empty response (${res.status})`);
  return json.data;
}

type Attendee = { displayName: string | null; email: string | null };
type Sentence = { speaker_name: string | null; text: string | null; start_time: number | null };
export type FFTranscript = {
  id: string;
  title: string | null;
  date: number | string | null;
  duration: number | null;
  organizer_email: string | null;
  meeting_link: string | null;
  audio_url: string | null;
  transcript_url: string | null;
  participants: string[] | null;
  meeting_attendees: Attendee[] | null;
  meeting_info: { summary_status: string | null; silent_meeting: boolean | null } | null;
  summary: { short_summary: string | null; overview: string | null; action_items: string | null; keywords: string[] | null } | null;
  sentences: Sentence[] | null;
};

const TRANSCRIPT_FIELDS = `
  id title date duration organizer_email meeting_link audio_url transcript_url
  participants
  meeting_attendees { displayName email }
  meeting_info { summary_status silent_meeting }
  summary { short_summary overview action_items keywords }
  sentences { speaker_name text start_time }
`;

export async function fetchTranscript(id: string): Promise<FFTranscript | null> {
  const data = await ffQuery<{ transcript: FFTranscript | null }>(
    `query T($id: String!) { transcript(id: $id) { ${TRANSCRIPT_FIELDS} } }`,
    { id },
  );
  return data.transcript ?? null;
}

export async function listRecentIds(opts: { limit?: number; fromDate?: string } = {}): Promise<string[]> {
  const data = await ffQuery<{ transcripts: { id: string }[] }>(
    `query R($limit: Int, $fromDate: DateTime) { transcripts(limit: $limit, fromDate: $fromDate) { id } }`,
    { limit: opts.limit ?? 25, fromDate: opts.fromDate ?? null },
  );
  return (data.transcripts ?? []).map((t) => t.id);
}

/** Parse the "**Name**\n<item> (mm:ss)" action-items blob into individual items. */
export function parseActionItems(raw: string | null | undefined): { name: string | null; text: string; timestamp: string | null }[] {
  if (!raw) return [];
  const out: { name: string | null; text: string; timestamp: string | null }[] = [];
  let name: string | null = null;
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const header = line.match(/^\*\*(.+?)\*\*$/);
    if (header) {
      name = header[1].trim();
      continue;
    }
    const ts = line.match(/\((\d{1,2}:\d{2}(?::\d{2})?)\)\s*$/);
    const text = (ts ? line.slice(0, ts.index) : line).replace(/^[-*\s]+/, "").trim();
    if (text) out.push({ name, text, timestamp: ts ? ts[1] : null });
  }
  return out;
}

/** Map "first last" and stage names → employee id, for pre-suggesting an assignee. */
async function staffNameMap(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await admin.from("employees").select("id,first_name,last_name,stage_name").eq("is_active", true);
  const map = new Map<string, string>();
  for (const e of data ?? []) {
    const full = [e.first_name, e.last_name].filter(Boolean).join(" ").toLowerCase().trim();
    if (full) map.set(full, e.id as string);
    if (e.stage_name) map.set((e.stage_name as string).toLowerCase().trim(), e.id as string);
  }
  return map;
}

/** Find the client (and, if unambiguous, event) for a meeting from its participant emails. */
export async function matchMeeting(
  admin: SupabaseClient,
  emails: string[],
): Promise<{ client_id: string | null; event_id: string | null; matched_by: "email" | null }> {
  const { data: staff } = await admin.from("employees").select("email");
  const staffEmails = new Set((staff ?? []).map((s) => (s.email as string)?.toLowerCase()).filter(Boolean));
  const candidates = [...new Set(emails.map((e) => e?.toLowerCase().trim()).filter(Boolean))].filter(
    (e) => e && !e.endsWith(`@${COMPANY_DOMAIN}`) && !staffEmails.has(e),
  );

  for (const email of candidates) {
    const { data: clients } = await admin.from("clients").select("id").ilike("email", email).limit(1);
    const client = clients?.[0];
    if (!client) continue;
    const { data: evs } = await admin
      .from("events")
      .select("id")
      .eq("client_id", client.id)
      .is("archived_at", null);
    return { client_id: client.id as string, event_id: evs?.length === 1 ? (evs[0].id as string) : null, matched_by: "email" };
  }
  return { client_id: null, event_id: null, matched_by: null };
}

/** Fetch one transcript and upsert it (+ suggested tasks). Preserves a manual event/client
    link and existing approve/dismiss decisions on re-import. Returns the meeting row id. */
export async function importTranscript(admin: SupabaseClient, firefliesId: string): Promise<string | null> {
  const t = await fetchTranscript(firefliesId);
  if (!t) return null;

  const emails = (t.participants && t.participants.length
    ? t.participants
    : (t.meeting_attendees ?? []).map((a) => a.email ?? "")
  ).filter(Boolean);

  const { data: existing } = await admin
    .from("fireflies_meetings")
    .select("id, event_id, client_id, matched_by")
    .eq("fireflies_id", t.id)
    .maybeSingle();

  let match: { client_id: string | null; event_id: string | null; matched_by: "email" | "manual" | null };
  if (existing?.matched_by === "manual") {
    match = { client_id: existing.client_id as string, event_id: existing.event_id as string, matched_by: "manual" };
  } else {
    match = await matchMeeting(admin, emails);
  }

  const sentences = (t.sentences ?? []).map((s) => ({ speaker: s.speaker_name, text: s.text, start: s.start_time }));
  const transcriptText = sentences.map((s) => `${s.speaker ?? "Speaker"}: ${s.text ?? ""}`).join("\n");
  const ms = t.date == null ? null : typeof t.date === "number" ? t.date : Number(t.date);

  const row = {
    fireflies_id: t.id,
    title: t.title,
    meeting_date: ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    duration_min: t.duration,
    organizer_email: t.organizer_email,
    meeting_link: t.meeting_link,
    audio_url: t.audio_url,
    transcript_url: t.transcript_url,
    participants: emails,
    attendees: (t.meeting_attendees ?? []).map((a) => ({ name: a.displayName, email: a.email })),
    summary_overview: t.summary?.short_summary || t.summary?.overview || null,
    keywords: t.summary?.keywords ?? [],
    action_items_raw: t.summary?.action_items ?? null,
    transcript: sentences,
    transcript_text: transcriptText,
    summary_status: t.meeting_info?.summary_status ?? null,
    event_id: match.event_id,
    client_id: match.client_id,
    matched_by: match.matched_by,
    updated_at: new Date().toISOString(),
  };

  const { data: up } = await admin
    .from("fireflies_meetings")
    .upsert(row, { onConflict: "fireflies_id" })
    .select("id")
    .maybeSingle();
  const meetingId = up?.id as string | undefined;
  if (!meetingId) return null;

  // Create suggestions only once per meeting (preserve prior approve/dismiss decisions).
  const { data: hasSuggestions } = await admin
    .from("fireflies_suggested_tasks")
    .select("id")
    .eq("meeting_id", meetingId)
    .limit(1);
  if (!hasSuggestions?.length) {
    const items = parseActionItems(row.action_items_raw);
    if (items.length) {
      const nameMap = await staffNameMap(admin);
      const rows = items.map((it) => ({
        meeting_id: meetingId,
        assignee_name: it.name,
        suggested_employee_id: it.name ? nameMap.get(it.name.toLowerCase().trim()) ?? null : null,
        text: it.text,
        timestamp_label: it.timestamp,
      }));
      await admin.from("fireflies_suggested_tasks").insert(rows);
    }
  }

  return meetingId;
}

/** Import recent meetings (backfill / manual sync button). */
export async function syncRecent(admin: SupabaseClient, opts: { limit?: number; fromDate?: string } = {}): Promise<{ imported: number }> {
  const ids = await listRecentIds({ limit: opts.limit ?? 25, fromDate: opts.fromDate });
  let imported = 0;
  for (const id of ids) {
    try {
      const r = await importTranscript(admin, id);
      if (r) imported++;
    } catch (e) {
      console.error("[fireflies] import failed", id, e);
    }
  }
  return { imported };
}
