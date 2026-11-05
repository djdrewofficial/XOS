/** Couple notes and staff-only notes on a planning moment.
    Pure helpers shared by the mobile route and the planner actions. */

export const PLANNING_NOTE_MAX = 4000;

export type PlanningNoteRole = "staff" | "host" | "guest";

export type ParsedNote =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/** Trim. Blank becomes null. Over the cap is an error. Non-strings are rejected
    so a JSON null does not silently clear a note. Send "" to clear. */
export function parsePlanningNote(input: unknown): ParsedNote {
  if (typeof input !== "string") return { ok: false, error: "Notes must be text." };
  const value = input.trim();
  if (value.length > PLANNING_NOTE_MAX) {
    return { ok: false, error: `Notes must be ${PLANNING_NOTE_MAX} characters or fewer.` };
  }
  return { ok: true, value: value.length ? value : null };
}

/** Who may read this moment's notes. Guests only when the section is marked
    guest-enabled (planning access). Anyone else on the event (host or staff) may. */
export function planningNotesAccess(
  role: PlanningNoteRole | null,
  guestEnabled: boolean,
): "ok" | "forbidden" {
  if (role === "staff" || role === "host") return "ok";
  if (role === "guest" && guestEnabled) return "ok";
  return "forbidden";
}

export type NotesGetBody = { notes: string | null; staffNotes?: string | null };

/** staffNotes is omitted entirely for anyone who is not staff. */
export function notesGetBody(
  notes: string | null,
  staffNotes: string | null,
  role: PlanningNoteRole,
): NotesGetBody {
  if (role === "staff") return { notes, staffNotes };
  return { notes };
}

export type NotesPutResult =
  | { ok: true; notes?: string | null; staffNotes?: string | null }
  | { ok: false; status: 400 | 403; error: string };

/** Validate a PUT body. staffNotes from a non-staff caller is 403 and nothing
    is applied. Guests cannot write couple notes. At least one field is required. */
export function parseNotesPut(body: unknown, role: PlanningNoteRole): NotesPutResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Missing fields" };
  }
  const rec = body as Record<string, unknown>;
  const hasNotes = Object.prototype.hasOwnProperty.call(rec, "notes");
  const hasStaff = Object.prototype.hasOwnProperty.call(rec, "staffNotes");
  if (!hasNotes && !hasStaff) return { ok: false, status: 400, error: "Missing fields" };
  if (hasStaff && role !== "staff") return { ok: false, status: 403, error: "Forbidden" };
  if (hasNotes && role === "guest") return { ok: false, status: 403, error: "Forbidden" };

  const out: { ok: true; notes?: string | null; staffNotes?: string | null } = { ok: true };
  if (hasNotes) {
    const parsed = parsePlanningNote(rec.notes);
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    out.notes = parsed.value;
  }
  if (hasStaff) {
    const parsed = parsePlanningNote(rec.staffNotes);
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    out.staffNotes = parsed.value;
  }
  return out;
}

/** True for a planning moment that is the couple's do-not-play list.
    Matches "Don't Play", "Do not play", and the same words with a curly apostrophe. */
export function isDoNotPlaySectionTitle(title: string): boolean {
  const n = title.toLowerCase().replace(/['’]/g, "");
  return n.includes("do not play") || n.includes("dont play");
}

export type DoNotPlayPut =
  | { ok: true; text: string | null }
  | { ok: false; status: 400; error: string };

/** PUT body is exactly { text: string | null }. Null and blank clear the text. */
export function parseDoNotPlayPut(body: unknown): DoNotPlayPut {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Missing fields" };
  }
  if (!Object.prototype.hasOwnProperty.call(body, "text")) {
    return { ok: false, status: 400, error: "Missing fields" };
  }
  const text = (body as { text: unknown }).text;
  if (text === null) return { ok: true, text: null };
  const parsed = parsePlanningNote(text);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  return { ok: true, text: parsed.value };
}

/** Map a Postgres write error to an HTTP status. RLS and the column guard are 403. */
export function noteWriteStatus(error: { code?: string; message?: string } | null): 403 | 500 | null {
  if (!error) return null;
  const message = error.message ?? "";
  if (error.code === "42501" || /row-level security|only client_notes/i.test(message)) return 403;
  return 500;
}
