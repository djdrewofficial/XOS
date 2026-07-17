"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe } from "@/lib/auth";
import { resolveEventRole, resolveUserNames, addLibrarySectionToEvent } from "@/lib/planning";
import { sendAccountInvite } from "@/lib/accounts";
import {
  getSpotifyConnection,
  listUserPlaylists,
  getPlaylistTracks,
  disconnectSpotify,
  type SpotifyPlaylistLite,
  type SpotifyTrackLite,
} from "@/lib/spotifyAuth";
import { reconcileSection, type SyncSectionRow } from "@/lib/spotifySync";
import { boothTemplates, boothFilters } from "@/lib/templatesbooth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "@/lib/auth";

/** Machine payload that `restorePlannerValue` replays. Absent = not restorable. */
export type PlannerSnapshot =
  | { kind: "answer"; questionId: string; answer: string | null }
  | { kind: "song_row"; row: Record<string, unknown> }
  | { kind: "song_patch"; songId: string; patch: Record<string, unknown> }
  | { kind: "question_row"; question: Record<string, unknown>; answer: Record<string, unknown> | null }
  | { kind: "section_tree"; section: Record<string, unknown>; questions: Record<string, unknown>[]; answers: Record<string, unknown>[]; songs: Record<string, unknown>[] }
  | { kind: "section_patch"; sectionId: string; patch: Record<string, unknown> };

/** What an audit entry points at, so staff can see a per-field history and
    restore a previous value. old/new are display text; snapshot drives Restore. */
type LogTarget = {
  sectionId?: string | null;
  questionId?: string | null;
  songId?: string | null;
  targetType?: "answer" | "song" | "question" | "section" | "settings";
  targetLabel?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  snapshot?: PlannerSnapshot | null;
};

/** Append a staff-visible audit entry. Best-effort — never blocks the action. */
async function logAction(
  supabase: SupabaseClient,
  eventId: string,
  me: Me,
  action: string,
  detail?: string,
  target: LogTarget = {},
) {
  try {
    const names = await resolveUserNames(supabase, [me.userId]);
    const role = me.accountType === "staff" ? "staff" : me.accountType === "client" ? "host" : "guest";
    await supabase.from("planning_audit_log").insert({
      event_id: eventId,
      actor_user_id: me.userId,
      actor_name: names.get(me.userId) ?? "Someone",
      actor_role: role,
      action,
      detail: detail ?? null,
      section_id: target.sectionId ?? null,
      question_id: target.questionId ?? null,
      song_id: target.songId ?? null,
      target_type: target.targetType ?? null,
      target_label: target.targetLabel ?? null,
      old_value: target.oldValue ?? null,
      new_value: target.newValue ?? null,
      snapshot: target.snapshot ?? null,
    });
  } catch {
    /* logging must never break the user's action */
  }
}

/** Compact human label for a song, used in history rows. */
function songLabel(s: { title?: string | null; artist?: string | null } | null): string | undefined {
  if (!s?.title) return undefined;
  return `${s.title}${s.artist ? ` — ${s.artist}` : ""}`;
}

const SETTING_LABELS: Record<string, string> = {
  title: "Title", icon: "Icon", intro: "Intro", section_type: "Type",
  guest_enabled: "Guest access", song_limit: "Song limit", must_play_limit: "Must-play limit",
  songs_enabled: "Songs", questions_enabled: "Questions", notes_enabled: "Notes",
  time_enabled: "Time", time_label: "Time", on_timeline: "On timeline", on_music: "On music",
  permissions: "Permissions",
};

/** Render a settings patch as "Title: Ceremony · Songs: on" for the history UI. */
function describeSettings(patch: Record<string, unknown>): string | null {
  const parts = Object.entries(patch).map(([k, v]) => {
    const label = SETTING_LABELS[k] ?? k;
    const val =
      v === null || v === "" ? "—"
      : typeof v === "boolean" ? (v ? "on" : "off")
      : typeof v === "object" ? JSON.stringify(v)
      : String(v);
    return `${label}: ${val}`;
  });
  return parts.length ? parts.join(" · ") : null;
}

/* Planner server actions. Writes are authorized by RLS (xos_can_access_event):
   a client can only touch planning rows for events they're attached to. We set
   requested_by/answered_by to the acting user. */

type SongInput = {
  sectionId: string;
  provider: "spotify" | "apple" | "youtube" | "manual";
  providerId?: string | null;
  isrc?: string | null;
  title: string;
  artist?: string | null;
  album?: string | null;
  artworkUrl?: string | null;
  durationMs?: number | null;
  previewUrl?: string | null;
  externalUrl?: string | null;
};

async function ctx(eventId: string) {
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me) throw new Error("Not signed in");
  return { supabase, me, revalidate: () => revalidatePath(`/portal/plan/${eventId}`) };
}

/** Throw unless the caller is staff or a host of the event. */
async function requireHost(eventId: string) {
  const c = await ctx(eventId);
  const role = await resolveEventRole(c.supabase, c.me.userId, c.me.accountType, eventId);
  if (role !== "staff" && role !== "host") throw new Error("Not allowed");
  return { ...c, role };
}

async function requireStaff(eventId: string) {
  const c = await ctx(eventId);
  if (c.me.accountType !== "staff") throw new Error("Staff only");
  return c;
}

export async function saveAnswer(eventId: string, questionId: string, answer: string) {
  const { supabase, me, revalidate } = await ctx(eventId);
  // Read the value we're about to replace, so the history can restore it.
  const { data: prev } = await supabase
    .from("planning_question_answers")
    .select("answer")
    .eq("question_id", questionId)
    .maybeSingle();
  const before = prev?.answer ?? null;

  const { error } = await supabase
    .from("planning_question_answers")
    .upsert(
      { question_id: questionId, event_id: eventId, answer, answered_by: me.userId, updated_at: new Date().toISOString() },
      { onConflict: "question_id" },
    );
  if (error) throw new Error(error.message);

  // This fires on blur, so skip no-op saves — they'd bury the real edits.
  if ((before ?? "") !== answer) {
    const { data: q } = await supabase
      .from("planning_questions")
      .select("prompt, section_id")
      .eq("id", questionId)
      .maybeSingle();
    await logAction(
      supabase,
      eventId,
      me,
      before ? (answer ? "Changed answer" : "Cleared answer") : "Answered question",
      q?.prompt ?? undefined,
      {
        questionId,
        sectionId: q?.section_id ?? null,
        targetType: "answer",
        targetLabel: q?.prompt ?? null,
        oldValue: before,
        newValue: answer || null,
        snapshot: { kind: "answer", questionId, answer: before },
      },
    );
  }
  revalidate();
}

export async function addSong(eventId: string, song: SongInput) {
  const { supabase, me, revalidate } = await ctx(eventId);

  // Append to the end of the section.
  const { data: last } = await supabase
    .from("planning_songs")
    .select("sort_order")
    .eq("section_id", song.sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (last?.sort_order ?? -1) + 1;

  const { data: created, error } = await supabase
    .from("planning_songs")
    .insert({
      section_id: song.sectionId,
      event_id: eventId,
      provider: song.provider,
      provider_id: song.providerId ?? null,
      isrc: song.isrc ?? null,
      title: song.title,
      artist: song.artist ?? null,
      album: song.album ?? null,
      artwork_url: song.artworkUrl ?? null,
      duration_ms: song.durationMs ?? null,
      preview_url: song.previewUrl ?? null,
      external_url: song.externalUrl ?? null,
      requested_by: me.userId,
      sort_order: nextOrder,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await logAction(supabase, eventId, me, "Added song", songLabel(song), {
    songId: created?.id ?? null,
    sectionId: song.sectionId,
    targetType: "song",
    targetLabel: songLabel(song) ?? null,
    newValue: songLabel(song) ?? null,
  });
  revalidate();
}

export async function removeSong(eventId: string, songId: string) {
  const { supabase, me, revalidate } = await ctx(eventId);
  // Snapshot the whole row before deleting — this is what "Restore" re-inserts.
  const { data: song } = await supabase.from("planning_songs").select("*").eq("id", songId).maybeSingle();
  const { error } = await supabase.from("planning_songs").delete().eq("id", songId);
  if (error) throw new Error(error.message);
  await logAction(supabase, eventId, me, "Removed song", songLabel(song), {
    songId,
    sectionId: song?.section_id ?? null,
    targetType: "song",
    targetLabel: songLabel(song) ?? null,
    oldValue: songLabel(song) ?? null,
    snapshot: song ? { kind: "song_row", row: song } : null,
  });
  revalidate();
}

export async function toggleMustPlay(eventId: string, songId: string, value: boolean) {
  const { supabase, me, revalidate } = await ctx(eventId);

  if (value) {
    // Enforce the staff-set must-play limit for the song's section.
    const { data: song } = await supabase
      .from("planning_songs")
      .select("section_id, title")
      .eq("id", songId)
      .maybeSingle();
    if (song) {
      const { data: section } = await supabase
        .from("planning_sections")
        .select("must_play_limit")
        .eq("id", song.section_id)
        .maybeSingle();
      const limit = section?.must_play_limit ?? null;
      if (limit != null) {
        const { count } = await supabase
          .from("planning_songs")
          .select("id", { count: "exact", head: true })
          .eq("section_id", song.section_id)
          .eq("must_play", true);
        if ((count ?? 0) >= limit) {
          return { ok: false, error: `Only ${limit} must-play song${limit === 1 ? "" : "s"} allowed here.` };
        }
      }
    }
  }

  const { data: row } = await supabase
    .from("planning_songs")
    .select("title, artist, section_id")
    .eq("id", songId)
    .maybeSingle();
  const { error } = await supabase.from("planning_songs").update({ must_play: value }).eq("id", songId);
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, value ? "Marked must-play" : "Unmarked must-play", songLabel(row), {
    songId,
    sectionId: row?.section_id ?? null,
    targetType: "song",
    targetLabel: songLabel(row) ?? null,
    oldValue: value ? "Not must-play" : "Must-play",
    newValue: value ? "Must-play" : "Not must-play",
    snapshot: { kind: "song_patch", songId, patch: { must_play: !value } },
  });
  revalidate();
  return { ok: true };
}

export async function updateSongNote(eventId: string, songId: string, note: string) {
  const { supabase, me, revalidate } = await ctx(eventId);
  const { data: row } = await supabase
    .from("planning_songs")
    .select("title, artist, note, section_id")
    .eq("id", songId)
    .maybeSingle();
  const before = row?.note ?? null;
  const { error } = await supabase
    .from("planning_songs")
    .update({ note: note || null })
    .eq("id", songId);
  if (error) throw new Error(error.message);
  if ((before ?? "") !== note) {
    await logAction(supabase, eventId, me, before ? "Changed song note" : "Added song note", songLabel(row), {
      songId,
      sectionId: row?.section_id ?? null,
      targetType: "song",
      targetLabel: songLabel(row) ?? null,
      oldValue: before,
      newValue: note || null,
      snapshot: { kind: "song_patch", songId, patch: { note: before } },
    });
  }
  revalidate();
}

export async function reorderSongs(eventId: string, sectionId: string, orderedIds: string[]) {
  const { supabase, me, revalidate } = await ctx(eventId);
  // Persist new positions one-by-one (sections are small).
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("planning_songs").update({ sort_order: i }).eq("id", id).eq("section_id", sectionId),
    ),
  );
  await logAction(supabase, eventId, me, "Reordered songs", undefined, {
    sectionId,
    targetType: "section",
  });
  revalidate();
}

export async function toggleLike(eventId: string, songId: string, liked: boolean) {
  const { supabase, me, revalidate } = await ctx(eventId);
  if (liked) {
    await supabase.from("planning_song_likes").insert({ song_id: songId, account_id: me.userId });
  } else {
    await supabase
      .from("planning_song_likes")
      .delete()
      .eq("song_id", songId)
      .eq("account_id", me.userId);
  }
  revalidate();
}

// ─────────────────────── Cover photo (hosts/staff) ───────────────────────

export async function uploadEventPhoto(eventId: string, formData: FormData) {
  const { revalidate } = await requireHost(eventId);
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "Image too large (max 8MB)" };

  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `${eventId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("event-photos")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (upErr) return { ok: false, error: upErr.message };

  const url = admin.storage.from("event-photos").getPublicUrl(path).data.publicUrl;
  const { error } = await admin.from("events").update({ cover_photo_url: url }).eq("id", eventId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function removeEventPhoto(eventId: string) {
  await requireHost(eventId);
  const admin = createAdminClient();
  await admin.from("events").update({ cover_photo_url: null }).eq("id", eventId);
  revalidatePath(`/portal/plan/${eventId}`);
}

// ─────────────────────── Guests (hosts/staff invite) ───────────────────────

export async function inviteGuest(
  eventId: string,
  input: { firstName: string; lastName: string; email: string; relationship: string },
) {
  await requireHost(eventId);
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required to send an invite." };

  const admin = createAdminClient();
  const { data: guest, error } = await admin
    .from("event_guests")
    .insert({
      event_id: eventId,
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      email,
      relationship: input.relationship.trim() || null,
    })
    .select("id")
    .single();
  if (error || !guest) return { ok: false, error: error?.message || "Could not add guest" };

  const res = await sendAccountInvite({
    type: "event_guest",
    email,
    name: input.firstName.trim() || null,
    eventGuestId: guest.id,
  });
  revalidatePath(`/portal/plan/${eventId}`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function resendGuestInvite(eventId: string, guestId: string) {
  await requireHost(eventId);
  const admin = createAdminClient();
  const { data: guest } = await admin
    .from("event_guests")
    .select("first_name, email")
    .eq("id", guestId)
    .maybeSingle();
  if (!guest?.email) return { ok: false, error: "No email on file" };
  const res = await sendAccountInvite({
    type: "event_guest",
    email: guest.email,
    name: guest.first_name || null,
    eventGuestId: guestId,
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function removeGuest(eventId: string, guestId: string) {
  await requireHost(eventId);
  const admin = createAdminClient();
  await admin.from("event_guests").delete().eq("id", guestId).eq("event_id", eventId);
  revalidatePath(`/portal/plan/${eventId}`);
}

// ─────────────────── Section guest access (staff predetermine) ───────────────────

export async function setSectionGuestAccess(eventId: string, sectionId: string, enabled: boolean) {
  const { supabase, me, revalidate } = await requireStaff(eventId);
  const { data: before } = await supabase
    .from("planning_sections")
    .select("title")
    .eq("id", sectionId)
    .maybeSingle();
  const { error } = await supabase
    .from("planning_sections")
    .update({ guest_enabled: enabled })
    .eq("id", sectionId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  await logAction(
    supabase,
    eventId,
    me,
    enabled ? "Enabled guest access" : "Disabled guest access",
    before?.title ?? undefined,
    {
      sectionId,
      targetType: "settings",
      targetLabel: before?.title ?? null,
      oldValue: enabled ? "Guest access: off" : "Guest access: on",
      newValue: enabled ? "Guest access: on" : "Guest access: off",
      snapshot: { kind: "section_patch", sectionId, patch: { guest_enabled: !enabled } },
    },
  );
  revalidate();
}

// ─────────────────────── Section settings (staff) ───────────────────────

type SectionSettingsInput = {
  title?: string;
  icon?: string | null;
  intro?: string | null;
  section_type?: "info" | "timeline" | "headline";
  guest_enabled?: boolean;
  song_limit?: number | null;
  must_play_limit?: number | null;
  songs_enabled?: boolean;
  questions_enabled?: boolean;
  notes_enabled?: boolean;
  time_enabled?: boolean;
  time_label?: string | null;
  on_timeline?: boolean | null;
  on_music?: boolean | null;
  permissions?: Record<string, string[]>;
};

export async function updateSectionSettings(
  eventId: string,
  sectionId: string,
  settings: SectionSettingsInput,
) {
  const { supabase, me, revalidate } = await requireStaff(eventId);
  // Snapshot only the keys this call actually changes, so the history shows the
  // specific setting that moved rather than the whole row.
  const { data: before } = await supabase
    .from("planning_sections")
    .select("*")
    .eq("id", sectionId)
    .maybeSingle();
  const changedBefore: Record<string, unknown> = {};
  for (const k of Object.keys(settings)) {
    if (before && k in before) changedBefore[k] = (before as Record<string, unknown>)[k];
  }
  const { error } = await supabase
    .from("planning_sections")
    .update(settings)
    .eq("id", sectionId)
    .eq("event_id", eventId);
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, "Updated section settings", settings.title ?? before?.title, {
    sectionId,
    targetType: "settings",
    targetLabel: (settings.title ?? before?.title) as string | null,
    oldValue: describeSettings(changedBefore),
    newValue: describeSettings(settings as Record<string, unknown>),
    snapshot: { kind: "section_patch", sectionId, patch: changedBefore },
  });
  revalidate();
  return { ok: true };
}

export async function addQuestion(
  eventId: string,
  sectionId: string,
  q: { prompt: string; answer_type: string; options?: string[]; help_text?: string; required?: boolean },
) {
  const { supabase, me, revalidate } = await requireStaff(eventId);
  const { data: last } = await supabase
    .from("planning_questions")
    .select("sort_order")
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: created, error } = await supabase
    .from("planning_questions")
    .insert({
      section_id: sectionId,
      event_id: eventId,
      prompt: q.prompt,
      answer_type: q.answer_type,
      options: q.options ?? [],
      help_text: q.help_text ?? null,
      required: q.required ?? false,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, "Added question", q.prompt, {
    questionId: created?.id ?? null,
    sectionId,
    targetType: "question",
    targetLabel: q.prompt,
    newValue: q.prompt,
  });
  revalidate();
  return { ok: true };
}

export async function updateQuestion(
  eventId: string,
  questionId: string,
  q: { prompt: string; answer_type: string; options?: string[]; help_text?: string; required?: boolean },
) {
  const { supabase, me, revalidate } = await requireStaff(eventId);
  const patch: Record<string, unknown> = {
    prompt: q.prompt,
    answer_type: q.answer_type,
    help_text: q.help_text ?? null,
    required: q.required ?? false,
  };
  // Only touch options when the caller manages them — preserves image/branching
  // option data for types this editor doesn't surface (e.g. image_select).
  if (q.options !== undefined) patch.options = q.options;
  const { data: before } = await supabase
    .from("planning_questions")
    .select("*")
    .eq("id", questionId)
    .maybeSingle();
  const { error } = await supabase
    .from("planning_questions")
    .update(patch)
    .eq("id", questionId)
    .eq("event_id", eventId);
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, "Edited question", q.prompt, {
    questionId,
    sectionId: before?.section_id ?? null,
    targetType: "question",
    targetLabel: q.prompt,
    oldValue: (before?.prompt as string | undefined) ?? null,
    newValue: q.prompt,
    snapshot: before ? { kind: "question_row", question: before, answer: null } : null,
  });
  revalidate();
  return { ok: true };
}

export async function deleteQuestion(eventId: string, questionId: string) {
  const { supabase, me, revalidate } = await requireStaff(eventId);
  // Snapshot the question *and* its answer — restoring a question without the
  // answer the host had typed into it would only be half a recovery.
  const { data: q } = await supabase.from("planning_questions").select("*").eq("id", questionId).maybeSingle();
  // select * — the snapshot is re-inserted verbatim, so it needs the full row
  // (question_id/event_id included), not just the display fields.
  const { data: ans } = await supabase
    .from("planning_question_answers")
    .select("*")
    .eq("question_id", questionId)
    .maybeSingle();
  const { error } = await supabase.from("planning_questions").delete().eq("id", questionId);
  if (error) throw new Error(error.message);
  await logAction(supabase, eventId, me, "Deleted question", q?.prompt ?? undefined, {
    questionId,
    sectionId: q?.section_id ?? null,
    targetType: "question",
    targetLabel: q?.prompt ?? null,
    oldValue: q?.prompt ?? null,
    snapshot: q ? { kind: "question_row", question: q, answer: ans ?? null } : null,
  });
  revalidate();
}

// ─────────────────── Reorder + delete sections (host/staff) ───────────────────

/** Insert a new section after the given sort position (-1 = top).
    Host + staff. Writes via admin (host lacks the staff-only section RLS) after
    the requireHost gate. Returns the new id so staff can open its settings. */
export async function addSection(
  eventId: string,
  afterSortOrder: number,
  input?: { title?: string; icon?: string; section_type?: "timeline" | "headline" },
) {
  const { supabase, me, revalidate } = await requireHost(eventId);
  const admin = createAdminClient();
  const pos = afterSortOrder + 1;

  // Open a gap: bump everything at/after the insert position.
  const { data: toBump } = await admin
    .from("planning_sections")
    .select("id, sort_order")
    .eq("event_id", eventId)
    .gte("sort_order", pos);
  await Promise.all(
    (toBump ?? []).map((s) =>
      admin.from("planning_sections").update({ sort_order: s.sort_order + 1 }).eq("id", s.id),
    ),
  );

  const title = input?.title?.trim() || "New Section";
  const { data: created, error } = await admin
    .from("planning_sections")
    .insert({
      event_id: eventId,
      title,
      icon: input?.icon?.trim() || null,
      section_type: input?.section_type || "timeline",
      sort_order: pos,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message };

  await logAction(supabase, eventId, me, "Added section", title);
  revalidate();
  return { ok: true, id: created.id as string };
}

export type LibrarySectionOption = {
  id: string;
  title: string;
  icon: string | null;
  module: string | null;
  section_type: string;
  question_count: number;
};

/** The reusable Section Templates library, for the staff "Add Section" picker. */
export async function listLibrarySections(eventId: string): Promise<LibrarySectionOption[]> {
  const { supabase } = await requireStaff(eventId);
  const { data: lib } = await supabase
    .from("planning_templates")
    .select("id")
    .eq("is_library", true)
    .maybeSingle();
  if (!lib) return [];
  const { data: secs } = await supabase
    .from("planning_template_sections")
    .select("id, title, icon, module, section_type")
    .eq("template_id", lib.id)
    .order("sort_order");
  if (!secs?.length) return [];

  // Question counts (one grouped read).
  const counts = new Map<string, number>();
  const { data: qs } = await supabase
    .from("planning_template_questions")
    .select("template_section_id")
    .in("template_section_id", secs.map((s) => s.id));
  for (const q of qs ?? []) counts.set(q.template_section_id, (counts.get(q.template_section_id) ?? 0) + 1);

  return secs.map((s) => ({
    id: s.id,
    title: s.title,
    icon: s.icon,
    module: s.module ?? null,
    section_type: s.section_type,
    question_count: counts.get(s.id) ?? 0,
  }));
}

/** Insert a copy of a library section into the event after the given sort pos.
    Staff only (library reads are staff-scoped). Returns the new section id. */
export async function addLibrarySection(eventId: string, afterSortOrder: number, templateSectionId: string) {
  const { supabase, me } = await requireStaff(eventId);
  const { data: ts } = await supabase
    .from("planning_template_sections")
    .select("title")
    .eq("id", templateSectionId)
    .maybeSingle();
  const id = await addLibrarySectionToEvent(eventId, templateSectionId, afterSortOrder);
  if (!id) return { ok: false as const, error: "Could not add section" };
  await logAction(supabase, eventId, me, "Added section from library", ts?.title ?? undefined);
  revalidatePath(`/portal/plan/${eventId}`);
  return { ok: true as const, id };
}

/** Set/clear a section's time label (the time shown on the planner + app
    timeline). Host + staff; host lacks the staff-only section write RLS so we
    write via admin after the role gate. */
export async function setSectionTime(eventId: string, sectionId: string, time: string | null) {
  const { supabase, me } = await requireHost(eventId);
  const admin = createAdminClient();
  const value = time && time.trim() ? time.trim() : null;
  const { data: before } = await admin
    .from("planning_sections")
    .select("title, time_label")
    .eq("id", sectionId)
    .maybeSingle();
  const { error } = await admin.from("planning_sections").update({ time_label: value }).eq("id", sectionId).eq("event_id", eventId);
  if (error) throw new Error(error.message);
  if ((before?.time_label ?? null) !== value) {
    await logAction(supabase, eventId, me, value ? "Set section time" : "Cleared section time", before?.title ?? undefined, {
      sectionId,
      targetType: "settings",
      targetLabel: before?.title ?? null,
      oldValue: before?.time_label ?? null,
      newValue: value,
      snapshot: { kind: "section_patch", sectionId, patch: { time_label: before?.time_label ?? null } },
    });
  }
  revalidatePath(`/portal/plan/${eventId}`);
}

export async function reorderSections(eventId: string, orderedIds: string[]) {
  const { supabase, me } = await requireHost(eventId);
  const admin = createAdminClient(); // host lacks staff-only section write RLS
  await Promise.all(
    orderedIds.map((id, i) =>
      admin.from("planning_sections").update({ sort_order: i }).eq("id", id).eq("event_id", eventId),
    ),
  );
  await logAction(supabase, eventId, me, "Reordered sections");
  revalidatePath(`/portal/plan/${eventId}`);
}

/** Staff = permanent delete. Host = soft delete (staff still see it). */
export async function deleteSection(eventId: string, sectionId: string) {
  const { supabase, me, role } = await requireHost(eventId);
  const admin = createAdminClient();
  const { data: sec } = await admin.from("planning_sections").select("*").eq("id", sectionId).maybeSingle();

  if (role === "staff") {
    // Permanent, and it cascades to the section's questions/answers/songs — so
    // snapshot the whole subtree first. This is the worst thing anyone can do
    // by mistake in the planner; without this it's unrecoverable.
    const [{ data: qs }, { data: songs }] = await Promise.all([
      admin.from("planning_questions").select("*").eq("section_id", sectionId),
      admin.from("planning_songs").select("*").eq("section_id", sectionId),
    ]);
    const questionIds = (qs ?? []).map((q) => q.id as string);
    const answers = questionIds.length
      ? (await admin.from("planning_question_answers").select("*").in("question_id", questionIds)).data
      : [];

    const { error } = await admin.from("planning_sections").delete().eq("id", sectionId).eq("event_id", eventId);
    if (error) throw new Error(error.message);
    await logAction(supabase, eventId, me, "Deleted section (permanent)", sec?.title ?? undefined, {
      sectionId,
      targetType: "section",
      targetLabel: sec?.title ?? null,
      oldValue: sec
        ? `${sec.title} (${(qs ?? []).length} question${(qs ?? []).length === 1 ? "" : "s"}, ${(songs ?? []).length} song${(songs ?? []).length === 1 ? "" : "s"})`
        : null,
      snapshot: sec
        ? { kind: "section_tree", section: sec, questions: qs ?? [], answers: answers ?? [], songs: songs ?? [] }
        : null,
    });
  } else {
    const { error } = await admin
      .from("planning_sections")
      .update({ deleted_by_host_at: new Date().toISOString(), deleted_by_host: me.userId })
      .eq("id", sectionId)
      .eq("event_id", eventId);
    if (error) throw new Error(error.message);
    await logAction(supabase, eventId, me, "Removed section (host)", sec?.title ?? undefined, {
      sectionId,
      targetType: "section",
      targetLabel: sec?.title ?? null,
    });
  }
  revalidatePath(`/portal/plan/${eventId}`);
}

/** Put a previous value back. Staff only. Reads the snapshot recorded on the
    audit entry and replays it, then logs the restore itself so the history
    always explains how the current value got there. */
export async function restorePlannerValue(eventId: string, auditId: string) {
  const { supabase, me, revalidate } = await requireStaff(eventId);
  const { data: entry } = await supabase
    .from("planning_audit_log")
    .select("id, event_id, snapshot, target_label, action")
    .eq("id", auditId)
    .eq("event_id", eventId) // never let one event's id restore into another
    .maybeSingle();
  if (!entry) return { ok: false as const, error: "History entry not found." };

  const snap = entry.snapshot as PlannerSnapshot | null;
  if (!snap) return { ok: false as const, error: "Nothing to restore on this entry." };

  // Writes go through admin: restoring a host-made change is a staff action, and
  // some targets (sections) are staff-write-only under RLS.
  const admin = createAdminClient();

  try {
    switch (snap.kind) {
      case "answer": {
        if (snap.answer === null) {
          await admin.from("planning_question_answers").delete().eq("question_id", snap.questionId);
        } else {
          await admin.from("planning_question_answers").upsert(
            {
              question_id: snap.questionId,
              event_id: eventId,
              answer: snap.answer,
              answered_by: me.userId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "question_id" },
          );
        }
        break;
      }
      case "song_row": {
        // upsert, not insert — the row may still exist if this is an older entry.
        await admin.from("planning_songs").upsert(snap.row, { onConflict: "id" });
        break;
      }
      case "song_patch": {
        await admin.from("planning_songs").update(snap.patch).eq("id", snap.songId).eq("event_id", eventId);
        break;
      }
      case "question_row": {
        await admin.from("planning_questions").upsert(snap.question, { onConflict: "id" });
        if (snap.answer) {
          await admin.from("planning_question_answers").upsert(snap.answer, { onConflict: "question_id" });
        }
        break;
      }
      case "section_tree": {
        await admin.from("planning_sections").upsert(snap.section, { onConflict: "id" });
        if (snap.questions.length) await admin.from("planning_questions").upsert(snap.questions, { onConflict: "id" });
        if (snap.songs.length) await admin.from("planning_songs").upsert(snap.songs, { onConflict: "id" });
        if (snap.answers.length)
          await admin.from("planning_question_answers").upsert(snap.answers, { onConflict: "question_id" });
        break;
      }
      case "section_patch": {
        await admin.from("planning_sections").update(snap.patch).eq("id", snap.sectionId).eq("event_id", eventId);
        break;
      }
      default:
        return { ok: false as const, error: "Unknown history entry." };
    }
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Restore failed." };
  }

  await logAction(supabase, eventId, me, "Restored", entry.target_label ?? undefined, {
    targetType: "settings",
    targetLabel: entry.target_label,
    newValue: `Undid: ${entry.action}`,
  });
  revalidate();
  return { ok: true as const };
}

export async function restoreSection(eventId: string, sectionId: string) {
  const { supabase, me, revalidate } = await requireStaff(eventId);
  const { error } = await supabase
    .from("planning_sections")
    .update({ deleted_by_host_at: null, deleted_by_host: null })
    .eq("id", sectionId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  await logAction(supabase, eventId, me, "Restored section");
  revalidate();
}

// ─────────────────── Vendor Team module (writes into XOS) ───────────────────

export async function searchVendors(eventId: string, query: string) {
  const { supabase } = await requireHost(eventId);
  const q = query.trim();
  if (q.length < 1) return [] as { id: string; company_name: string; category: string | null }[];
  const { data } = await supabase
    .from("vendors")
    .select("id, company_name, category")
    .ilike("company_name", `%${q}%`)
    .order("company_name")
    .limit(8);
  return data ?? [];
}

type VendorInput = {
  id?: string | null; // existing event_vendors row id (edit)
  vendorId?: string | null; // chosen directory vendor
  companyName: string;
  role: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  arrivalTime?: string;
};

export async function saveEventVendor(eventId: string, input: VendorInput) {
  const { supabase, me, revalidate } = await requireHost(eventId);
  const admin = createAdminClient();
  const company = input.companyName.trim();
  if (!company) return { ok: false, error: "Company / vendor name is required." };

  // 1) Resolve the directory vendor (pick chosen, match by name, or create).
  let vendorId = input.vendorId ?? null;
  if (!vendorId) {
    const { data: existing } = await admin
      .from("vendors")
      .select("id")
      .ilike("company_name", company)
      .limit(1)
      .maybeSingle();
    if (existing) vendorId = existing.id;
  }
  if (!vendorId) {
    const { data: created, error } = await admin
      .from("vendors")
      .insert({ company_name: company, category: input.role || null })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: error?.message || "Could not create vendor" };
    vendorId = created.id;
  }

  const fields = {
    role: input.role || "Vendor",
    arrival_time: input.arrivalTime?.trim() || null,
    contact_name: input.contactName?.trim() || null,
    contact_phone: input.contactPhone?.trim() || null,
    contact_email: input.contactEmail?.trim() || null,
  };

  // 2) Upsert the event_vendors link (unique per event+vendor).
  if (input.id) {
    const { error } = await admin.from("event_vendors").update({ vendor_id: vendorId, ...fields }).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data: dupe } = await admin
      .from("event_vendors")
      .select("id")
      .eq("event_id", eventId)
      .eq("vendor_id", vendorId)
      .maybeSingle();
    if (dupe) {
      await admin.from("event_vendors").update(fields).eq("id", dupe.id);
    } else {
      const { error } = await admin.from("event_vendors").insert({ event_id: eventId, vendor_id: vendorId, ...fields });
      if (error) return { ok: false, error: error.message };
    }
  }

  // 3) Mirror the contact into the directory (best effort).
  if (fields.contact_name) {
    const { data: c } = await admin
      .from("vendor_contacts")
      .select("id")
      .eq("vendor_id", vendorId)
      .ilike("name", fields.contact_name)
      .maybeSingle();
    if (c) {
      await admin.from("vendor_contacts").update({ role: fields.role, phone: fields.contact_phone, email: fields.contact_email }).eq("id", c.id);
    } else {
      await admin.from("vendor_contacts").insert({ vendor_id: vendorId, name: fields.contact_name, role: fields.role, phone: fields.contact_phone, email: fields.contact_email });
    }
  }

  await logAction(supabase, eventId, me, "Updated vendor team", `${input.role}: ${company}`);
  revalidate();
  return { ok: true };
}

export async function removeEventVendor(eventId: string, eventVendorId: string) {
  const { supabase, me, revalidate } = await requireHost(eventId);
  const admin = createAdminClient();
  const { error } = await admin.from("event_vendors").delete().eq("id", eventVendorId).eq("event_id", eventId);
  if (error) throw new Error(error.message);
  await logAction(supabase, eventId, me, "Removed vendor");
  revalidate();
}

// ─────────────────── Spotify: connect + import playlists ───────────────────

export async function spotifyStatus(eventId: string): Promise<{ connected: boolean; displayName: string | null }> {
  const { me } = await requireHost(eventId);
  return getSpotifyConnection(me.userId);
}

export async function spotifyPlaylists(eventId: string): Promise<SpotifyPlaylistLite[]> {
  const { me } = await requireHost(eventId);
  return listUserPlaylists(me.userId);
}

export async function disconnectSpotifyAccount(eventId: string) {
  const { me, revalidate } = await requireHost(eventId);
  await disconnectSpotify(me.userId);
  revalidate();
}

export async function importSpotifyPlaylist(eventId: string, sectionId: string, playlistId: string) {
  const { supabase, me, revalidate } = await requireHost(eventId);
  const tracks = await getPlaylistTracks(me.userId, playlistId);
  if (tracks.length === 0) return { ok: false, error: "That playlist looks empty (or your Spotify needs reconnecting)." };

  // Respect a section song limit if one is set.
  const { data: section } = await supabase.from("planning_sections").select("song_limit").eq("id", sectionId).maybeSingle();
  const { data: last } = await supabase
    .from("planning_songs")
    .select("sort_order")
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { count: existing } = await supabase
    .from("planning_songs")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId);

  let toAdd = tracks;
  if (section?.song_limit != null) {
    const room = Math.max(0, section.song_limit - (existing ?? 0));
    toAdd = tracks.slice(0, room);
    if (toAdd.length === 0) return { ok: false, error: `This section is full (limit ${section.song_limit}).` };
  }

  let order = (last?.sort_order ?? -1) + 1;
  const rows = toAdd.map((t) => ({
    section_id: sectionId,
    event_id: eventId,
    provider: "spotify" as const,
    provider_id: t.providerId,
    isrc: t.isrc,
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork_url: t.artworkUrl,
    duration_ms: t.durationMs,
    preview_url: t.previewUrl,
    external_url: t.externalUrl,
    requested_by: me.userId,
    sort_order: order++,
  }));

  const { error } = await supabase.from("planning_songs").insert(rows);
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, "Imported Spotify playlist", `${rows.length} songs`);
  revalidate();
  return { ok: true, count: rows.length };
}

/** Tracks of a playlist, for the import picker. */
export async function spotifyPlaylistTracks(eventId: string, playlistId: string): Promise<SpotifyTrackLite[]> {
  const { me } = await requireHost(eventId);
  return getPlaylistTracks(me.userId, playlistId);
}

type SpotifyTrackInput = {
  providerId: string;
  isrc: string | null;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  previewUrl: string | null;
  externalUrl: string | null;
};

/** One-time import of a selected subset of tracks (respects the song limit). */
export async function importSpotifyTracks(eventId: string, sectionId: string, tracks: SpotifyTrackInput[]) {
  const { supabase, me, revalidate } = await requireHost(eventId);
  if (!tracks.length) return { ok: false, error: "No songs selected" };

  const { data: section } = await supabase.from("planning_sections").select("song_limit").eq("id", sectionId).maybeSingle();
  const { data: last } = await supabase
    .from("planning_songs")
    .select("sort_order")
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { count: existing } = await supabase
    .from("planning_songs")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId);

  let toAdd = tracks;
  if (section?.song_limit != null) {
    const room = Math.max(0, section.song_limit - (existing ?? 0));
    toAdd = tracks.slice(0, room);
    if (toAdd.length === 0) return { ok: false, error: `This section is full (limit ${section.song_limit}).` };
  }

  let order = (last?.sort_order ?? -1) + 1;
  const rows = toAdd.map((t) => ({
    section_id: sectionId,
    event_id: eventId,
    provider: "spotify" as const,
    provider_id: t.providerId,
    isrc: t.isrc,
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork_url: t.artworkUrl,
    duration_ms: t.durationMs,
    preview_url: t.previewUrl,
    external_url: t.externalUrl,
    requested_by: me.userId,
    sort_order: order++,
  }));
  const { error } = await supabase.from("planning_songs").insert(rows);
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, "Imported Spotify songs", `${rows.length} songs`);
  revalidate();
  return { ok: true, count: rows.length };
}

/** Bind a section to a playlist for hourly live-sync + run an initial sync. */
export async function enablePlaylistSync(
  eventId: string,
  sectionId: string,
  playlistId: string,
  playlistName: string,
): Promise<{ ok: true; added: number; removed: number } | { ok: false; error: string }> {
  const { supabase, me, revalidate } = await requireHost(eventId);
  const admin = createAdminClient(); // planning_sections is staff-write under RLS
  const { error } = await admin
    .from("planning_sections")
    .update({ spotify_sync_playlist_id: playlistId, spotify_sync_playlist_name: playlistName, spotify_sync_user_id: me.userId })
    .eq("id", sectionId)
    .eq("event_id", eventId);
  if (error) return { ok: false, error: error.message };

  const { data: section } = await admin
    .from("planning_sections")
    .select("id, event_id, song_limit, spotify_sync_playlist_id, spotify_sync_user_id")
    .eq("id", sectionId)
    .maybeSingle();
  let result = { added: 0, removed: 0 };
  if (section) result = await reconcileSection(admin, section as SyncSectionRow);

  await logAction(supabase, eventId, me, "Enabled Spotify live-sync", playlistName);
  revalidate();
  return { ok: true, ...result };
}

/** Stop live-syncing a section. Keeps the songs (they become manual). */
export async function disablePlaylistSync(eventId: string, sectionId: string) {
  const { supabase, me, revalidate } = await requireHost(eventId);
  const admin = createAdminClient();
  await admin
    .from("planning_sections")
    .update({ spotify_sync_playlist_id: null, spotify_sync_playlist_name: null, spotify_sync_user_id: null, spotify_synced_at: null })
    .eq("id", sectionId)
    .eq("event_id", eventId);
  await admin.from("planning_songs").update({ synced: false }).eq("section_id", sectionId).eq("synced", true);
  await logAction(supabase, eventId, me, "Disabled Spotify live-sync");
  revalidate();
  return { ok: true };
}

// ─────────────────── Photo Booth module (backdrops + designs) ───────────────────

export type BoothBackdrop = { id: string; name: string; image_url: string; category: string | null };
export type BoothDesign = {
  src: string;
  post_url: string | null;
  layout_size: string | null;
  image_type: string | null;
  no_of_images: string | null;
  type: string | null;
  type_name: string | null;
  video_url?: string | null;
  poster?: string | null;
};
export type BoothSelection = {
  backdrop_id: string | null;
  design: BoothDesign | null;
  picked_by_name: string | null;
  updated_at: string | null;
} | null;

/** Active backdrops + this event's saved selection (RLS-scoped), with the name
    of whoever last picked (so staff can see who chose what). */
export async function loadPhotoBooth(
  eventId: string,
): Promise<{ backdrops: BoothBackdrop[]; selection: BoothSelection }> {
  const { supabase } = await ctx(eventId);
  const [{ data: backdrops }, { data: sel }] = await Promise.all([
    supabase
      .from("photobooth_backdrops")
      .select("id, name, image_url, category")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("event_photobooth_selection")
      .select("backdrop_id, design, updated_by, updated_at")
      .eq("event_id", eventId)
      .maybeSingle(),
  ]);

  let picked_by_name: string | null = null;
  if (sel?.updated_by) {
    const names = await resolveUserNames(supabase, [sel.updated_by]);
    picked_by_name = names.get(sel.updated_by) ?? null;
  }

  return {
    backdrops: (backdrops ?? []) as BoothBackdrop[],
    selection: sel
      ? {
          backdrop_id: sel.backdrop_id,
          design: (sel.design as BoothDesign) ?? null,
          picked_by_name,
          updated_at: sel.updated_at,
        }
      : null,
  };
}

export async function selectBackdrop(eventId: string, backdropId: string | null) {
  const { supabase, me, revalidate } = await requireHost(eventId);
  const { error } = await supabase
    .from("event_photobooth_selection")
    .upsert(
      { event_id: eventId, backdrop_id: backdropId, updated_by: me.userId, updated_at: new Date().toISOString() },
      { onConflict: "event_id" },
    );
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, "Selected photo-booth backdrop");
  revalidate();
  return { ok: true };
}

export async function selectBoothDesign(eventId: string, design: BoothDesign | null) {
  const { supabase, me, revalidate } = await requireHost(eventId);
  const { error } = await supabase
    .from("event_photobooth_selection")
    .upsert(
      { event_id: eventId, design, updated_by: me.userId, updated_at: new Date().toISOString() },
      { onConflict: "event_id" },
    );
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, "Selected photo-booth design", design?.type_name ?? undefined);
  revalidate();
  return { ok: true };
}

/** Proxy TemplatesBooth /templates (key stays server-side). Host/staff only. */
export async function fetchBoothTemplates(eventId: string, params: Record<string, string | number>) {
  await requireHost(eventId);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) sp.set(k, String(v));
  const res = await boothTemplates(sp);
  return res.ok ? { ok: true as const, data: res.data } : { ok: false as const, error: res.error };
}

/** Proxy TemplatesBooth /filters. Host/staff only. */
export async function fetchBoothFilters(eventId: string) {
  await requireHost(eventId);
  const res = await boothFilters();
  return res.ok ? { ok: true as const, data: res.data } : { ok: false as const, error: res.error };
}

export async function uploadSectionCover(eventId: string, sectionId: string, formData: FormData) {
  const { revalidate } = await requireStaff(eventId);
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `${eventId}/sections/${sectionId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("event-photos")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (upErr) return { ok: false, error: upErr.message };
  const url = admin.storage.from("event-photos").getPublicUrl(path).data.publicUrl;
  await admin.from("planning_sections").update({ section_cover_url: url }).eq("id", sectionId);
  revalidate();
  return { ok: true };
}
