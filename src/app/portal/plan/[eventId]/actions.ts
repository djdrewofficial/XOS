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
} from "@/lib/spotifyAuth";
import { boothTemplates, boothFilters } from "@/lib/templatesbooth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "@/lib/auth";

/** Append a staff-visible audit entry. Best-effort — never blocks the action. */
async function logAction(
  supabase: SupabaseClient,
  eventId: string,
  me: Me,
  action: string,
  detail?: string,
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
    });
  } catch {
    /* logging must never break the user's action */
  }
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
  const { error } = await supabase
    .from("planning_question_answers")
    .upsert(
      { question_id: questionId, event_id: eventId, answer, answered_by: me.userId, updated_at: new Date().toISOString() },
      { onConflict: "question_id" },
    );
  if (error) throw new Error(error.message);
  const { data: q } = await supabase.from("planning_questions").select("prompt").eq("id", questionId).maybeSingle();
  await logAction(supabase, eventId, me, "Answered question", q?.prompt ?? undefined);
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

  const { error } = await supabase.from("planning_songs").insert({
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
  });
  if (error) throw new Error(error.message);
  await logAction(supabase, eventId, me, "Added song", `${song.title}${song.artist ? ` — ${song.artist}` : ""}`);
  revalidate();
}

export async function removeSong(eventId: string, songId: string) {
  const { supabase, me, revalidate } = await ctx(eventId);
  const { data: song } = await supabase.from("planning_songs").select("title, artist").eq("id", songId).maybeSingle();
  const { error } = await supabase.from("planning_songs").delete().eq("id", songId);
  if (error) throw new Error(error.message);
  await logAction(supabase, eventId, me, "Removed song", song ? `${song.title}${song.artist ? ` — ${song.artist}` : ""}` : undefined);
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

  const { error } = await supabase.from("planning_songs").update({ must_play: value }).eq("id", songId);
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, value ? "Marked must-play" : "Unmarked must-play");
  revalidate();
  return { ok: true };
}

export async function updateSongNote(eventId: string, songId: string, note: string) {
  const { supabase, revalidate } = await ctx(eventId);
  const { error } = await supabase
    .from("planning_songs")
    .update({ note: note || null })
    .eq("id", songId);
  if (error) throw new Error(error.message);
  revalidate();
}

export async function reorderSongs(eventId: string, sectionId: string, orderedIds: string[]) {
  const { supabase, revalidate } = await ctx(eventId);
  // Persist new positions one-by-one (sections are small).
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("planning_songs").update({ sort_order: i }).eq("id", id).eq("section_id", sectionId),
    ),
  );
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
  const { error } = await supabase
    .from("planning_sections")
    .update({ guest_enabled: enabled })
    .eq("id", sectionId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  await logAction(supabase, eventId, me, enabled ? "Enabled guest access" : "Disabled guest access");
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
  permissions?: Record<string, string[]>;
};

export async function updateSectionSettings(
  eventId: string,
  sectionId: string,
  settings: SectionSettingsInput,
) {
  const { supabase, me, revalidate } = await requireStaff(eventId);
  const { error } = await supabase
    .from("planning_sections")
    .update(settings)
    .eq("id", sectionId)
    .eq("event_id", eventId);
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, "Updated section settings", settings.title);
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
  const { error } = await supabase.from("planning_questions").insert({
    section_id: sectionId,
    event_id: eventId,
    prompt: q.prompt,
    answer_type: q.answer_type,
    options: q.options ?? [],
    help_text: q.help_text ?? null,
    required: q.required ?? false,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return { ok: false, error: error.message };
  await logAction(supabase, eventId, me, "Added question", q.prompt);
  revalidate();
  return { ok: true };
}

export async function deleteQuestion(eventId: string, questionId: string) {
  const { supabase, me, revalidate } = await requireStaff(eventId);
  const { data: q } = await supabase.from("planning_questions").select("prompt").eq("id", questionId).maybeSingle();
  const { error } = await supabase.from("planning_questions").delete().eq("id", questionId);
  if (error) throw new Error(error.message);
  await logAction(supabase, eventId, me, "Deleted question", q?.prompt ?? undefined);
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
  const { data: sec } = await admin.from("planning_sections").select("title").eq("id", sectionId).maybeSingle();

  if (role === "staff") {
    const { error } = await admin.from("planning_sections").delete().eq("id", sectionId).eq("event_id", eventId);
    if (error) throw new Error(error.message);
    await logAction(supabase, eventId, me, "Deleted section (permanent)", sec?.title ?? undefined);
  } else {
    const { error } = await admin
      .from("planning_sections")
      .update({ deleted_by_host_at: new Date().toISOString(), deleted_by_host: me.userId })
      .eq("id", sectionId)
      .eq("event_id", eventId);
    if (error) throw new Error(error.message);
    await logAction(supabase, eventId, me, "Removed section (host)", sec?.title ?? undefined);
  }
  revalidatePath(`/portal/plan/${eventId}`);
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
