/* Mobile playlist song mutations — hosts edit; guests follow existing RLS
   (guest_enabled sections, own songs for remove/update). Uses the caller's
   JWT client so policies apply. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPlaylists, type MobilePlaylist } from "@/lib/planningPlaylists";

export type PlaylistSongAddInput = {
  sectionId: string;
  title: string;
  artist?: string | null;
  note?: string | null;
  externalUrl?: string | null;
  provider?: "spotify" | "apple" | "youtube" | "manual";
  providerId?: string | null;
  album?: string | null;
  artworkUrl?: string | null;
  durationMs?: number | null;
  previewUrl?: string | null;
  isrc?: string | null;
};

export async function loadEventPlaylists(
  rls: SupabaseClient,
  eventId: string,
  role: "staff" | "host" | "guest",
): Promise<{ playlists: MobilePlaylist[]; error?: string }> {
  const [secRes, songRes] = await Promise.all([
    rls
      .from("planning_sections")
      .select("id, title, is_playlist, song_limit, guest_enabled, deleted_by_host_at, sort_order")
      .eq("event_id", eventId)
      .order("sort_order"),
    rls
      .from("planning_songs")
      .select("id, section_id, title, artist, note, external_url, requested_by, must_play, do_not_play, sort_order, hidden_at")
      .eq("event_id", eventId)
      .order("sort_order"),
  ]);

  // Pre-migration: is_playlist missing — return empty playlists (flat songs still work).
  if (secRes.error && /is_playlist|schema cache/i.test(secRes.error.message ?? "")) {
    return { playlists: [] };
  }
  if (secRes.error) return { playlists: [], error: secRes.error.message };
  if (songRes.error) return { playlists: [], error: songRes.error.message };

  const songs = (songRes.data ?? [])
    .filter((row) => !row.hidden_at || role === "staff")
    .map((row) => ({
      id: row.id as string,
      sectionId: row.section_id as string,
      title: (row.title as string) ?? "",
      artist: (row.artist as string | null) ?? null,
      note: (row.note as string | null) ?? null,
      externalUrl: (row.external_url as string | null) ?? null,
      requestedBy: (row.requested_by as string | null) ?? null,
      mustPlay: Boolean(row.must_play),
      doNotPlay: Boolean(row.do_not_play),
      sortOrder: (row.sort_order as number) ?? 0,
      hidden: Boolean(row.hidden_at),
    }));

  const sections = (secRes.data ?? []).map((row) => ({
    id: row.id as string,
    title: (row.title as string) ?? "",
    isPlaylist: Boolean(row.is_playlist),
    songLimit: (row.song_limit as number | null) ?? null,
    guestEnabled: Boolean(row.guest_enabled),
    deletedByHost: Boolean(row.deleted_by_host_at),
    sortOrder: (row.sort_order as number) ?? 0,
  }));

  return { playlists: buildPlaylists({ sections, songs, role }) };
}

export async function addPlaylistSong(
  rls: SupabaseClient,
  opts: {
    eventId: string;
    userId: string;
    song: PlaylistSongAddInput;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const title = opts.song.title?.trim();
  if (!title) return { ok: false, error: "Song title is required.", status: 400 };
  if (!opts.song.sectionId) return { ok: false, error: "sectionId is required.", status: 400 };

  const { data: section } = await rls
    .from("planning_sections")
    .select("id, is_playlist, songs_enabled, song_limit, guest_enabled, deleted_by_host_at")
    .eq("id", opts.song.sectionId)
    .eq("event_id", opts.eventId)
    .maybeSingle();
  if (!section || section.deleted_by_host_at) {
    return { ok: false, error: "Playlist not found.", status: 404 };
  }
  if (!section.is_playlist && !section.songs_enabled) {
    return { ok: false, error: "That moment is not a playlist.", status: 400 };
  }

  if (section.song_limit != null) {
    const { count } = await rls
      .from("planning_songs")
      .select("id", { count: "exact", head: true })
      .eq("section_id", opts.song.sectionId)
      .eq("event_id", opts.eventId)
      .is("hidden_at", null);
    if ((count ?? 0) >= section.song_limit) {
      return {
        ok: false,
        error: `This playlist is limited to ${section.song_limit} song${section.song_limit === 1 ? "" : "s"}.`,
        status: 400,
      };
    }
  }

  const { data: last } = await rls
    .from("planning_songs")
    .select("sort_order")
    .eq("section_id", opts.song.sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (last?.sort_order ?? -1) + 1;

  const { data: created, error } = await rls
    .from("planning_songs")
    .insert({
      section_id: opts.song.sectionId,
      event_id: opts.eventId,
      provider: opts.song.provider ?? "manual",
      provider_id: opts.song.providerId ?? null,
      isrc: opts.song.isrc ?? null,
      title,
      artist: opts.song.artist?.trim() || null,
      album: opts.song.album ?? null,
      artwork_url: opts.song.artworkUrl ?? null,
      duration_ms: opts.song.durationMs ?? null,
      preview_url: opts.song.previewUrl ?? null,
      external_url: opts.song.externalUrl?.trim() || null,
      note: opts.song.note?.trim() || null,
      requested_by: opts.userId,
      sort_order: nextOrder,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "42501" || /policy|permission|rls/i.test(error.message ?? "")) {
      return { ok: false, error: "You don't have access to add songs here.", status: 403 };
    }
    return { ok: false, error: error.message, status: 500 };
  }
  return { ok: true, id: created!.id as string };
}

export async function removePlaylistSong(
  rls: SupabaseClient,
  opts: { eventId: string; userId: string; songId: string },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!opts.songId) return { ok: false, error: "songId is required.", status: 400 };

  const hidden = await rls
    .from("planning_songs")
    .update({ hidden_at: new Date().toISOString(), hidden_by: opts.userId })
    .eq("id", opts.songId)
    .eq("event_id", opts.eventId)
    .select("id");

  let error = hidden.error;
  if (error && /hidden_at|schema cache/i.test(error.message ?? "")) {
    const removed = await rls.from("planning_songs").delete().eq("id", opts.songId).eq("event_id", opts.eventId);
    error = removed.error;
  } else if (!error && (hidden.data?.length ?? 0) === 0) {
    return { ok: false, error: "You can only remove your own content.", status: 403 };
  }

  if (error) {
    if (error.code === "42501" || /only remove your own|policy|permission/i.test(error.message ?? "")) {
      return { ok: false, error: "You can only remove your own content.", status: 403 };
    }
    return { ok: false, error: error.message, status: 500 };
  }
  return { ok: true };
}

export async function reorderPlaylistSongs(
  rls: SupabaseClient,
  opts: { eventId: string; sectionId: string; orderedIds: string[] },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!opts.sectionId) return { ok: false, error: "sectionId is required.", status: 400 };
  if (!Array.isArray(opts.orderedIds) || opts.orderedIds.length === 0) {
    return { ok: false, error: "orderedIds is required.", status: 400 };
  }

  const { data: section } = await rls
    .from("planning_sections")
    .select("id, is_playlist, deleted_by_host_at")
    .eq("id", opts.sectionId)
    .eq("event_id", opts.eventId)
    .maybeSingle();
  if (!section || section.deleted_by_host_at) {
    return { ok: false, error: "Playlist not found.", status: 404 };
  }

  const results = await Promise.all(
    opts.orderedIds.map((id, i) =>
      rls
        .from("planning_songs")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("section_id", opts.sectionId)
        .eq("event_id", opts.eventId),
    ),
  );
  const firstErr = results.find((r) => r.error)?.error;
  if (firstErr) {
    if (firstErr.code === "42501" || /policy|permission/i.test(firstErr.message ?? "")) {
      return { ok: false, error: "You don't have access to reorder songs here.", status: 403 };
    }
    return { ok: false, error: firstErr.message, status: 500 };
  }
  return { ok: true };
}
