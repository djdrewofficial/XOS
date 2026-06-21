/* Live Spotify playlist sync for planner song sections. Reconciles a section's
   sync-managed songs against the live playlist: adds new tracks, removes ones
   pulled off the playlist, and never touches manually-added songs. Server-only;
   uses the admin client (called from the host action on enable + the hourly
   cron). */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPlaylistTracksStrict } from "@/lib/spotifyAuth";

type Admin = ReturnType<typeof createAdminClient>;

export interface SyncSectionRow {
  id: string;
  event_id: string;
  song_limit: number | null;
  spotify_sync_playlist_id: string;
  spotify_sync_user_id: string | null;
}

export interface ReconcileResult {
  added: number;
  removed: number;
  skipped?: string;
}

/** Reconcile one live-synced section against its Spotify playlist. */
export async function reconcileSection(admin: Admin, section: SyncSectionRow): Promise<ReconcileResult> {
  if (!section.spotify_sync_user_id) return { added: 0, removed: 0, skipped: "no connected user" };

  const tracks = await fetchPlaylistTracksStrict(section.spotify_sync_user_id, section.spotify_sync_playlist_id);
  // null = token/fetch failure → skip (don't wipe the section on a transient error)
  if (tracks === null) return { added: 0, removed: 0, skipped: "fetch failed" };

  const wanted = new Map(tracks.map((t) => [t.providerId, t]));

  const { data: songs } = await admin
    .from("planning_songs")
    .select("id, provider_id, synced, sort_order")
    .eq("section_id", section.id);
  const all = songs ?? [];
  const present = new Set(all.map((s) => s.provider_id).filter(Boolean) as string[]);

  // Remove sync-managed songs no longer on the playlist (leave manual songs).
  const toRemove = all.filter((s) => s.synced && (!s.provider_id || !wanted.has(s.provider_id))).map((s) => s.id);
  if (toRemove.length) await admin.from("planning_songs").delete().in("id", toRemove);

  // Add playlist tracks not already in the section (whether synced or manual).
  let toAdd = tracks.filter((t) => !present.has(t.providerId));

  const remaining = all.length - toRemove.length;
  if (section.song_limit != null) {
    const room = Math.max(0, section.song_limit - remaining);
    toAdd = toAdd.slice(0, room);
  }

  let order = Math.max(-1, ...all.map((s) => (s.sort_order as number) ?? 0)) + 1;
  if (toAdd.length) {
    const rows = toAdd.map((t) => ({
      section_id: section.id,
      event_id: section.event_id,
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
      synced: true,
      sort_order: order++,
    }));
    await admin.from("planning_songs").insert(rows);
  }

  await admin.from("planning_sections").update({ spotify_synced_at: new Date().toISOString() }).eq("id", section.id);
  return { added: toAdd.length, removed: toRemove.length };
}

/** Reconcile every live-synced section (the hourly cron). */
export async function syncAllSections(admin: Admin): Promise<{ sections: number; added: number; removed: number }> {
  const { data: sections } = await admin
    .from("planning_sections")
    .select("id, event_id, song_limit, spotify_sync_playlist_id, spotify_sync_user_id")
    .not("spotify_sync_playlist_id", "is", null);

  let added = 0;
  let removed = 0;
  for (const s of sections ?? []) {
    const r = await reconcileSection(admin, s as SyncSectionRow);
    added += r.added;
    removed += r.removed;
  }
  return { sections: (sections ?? []).length, added, removed };
}
