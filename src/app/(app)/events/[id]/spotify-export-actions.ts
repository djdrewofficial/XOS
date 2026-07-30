"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModule } from "@/lib/auth";
import { getSpotifyConnection, createSpotifyPlaylist, addTracksToSpotifyPlaylist } from "@/lib/spotifyAuth";
import { searchMusic } from "@/lib/music";

/* Staff-only: export selected planner sections to the signed-in staffer's own
   Spotify as one playlist per section, named "MM/DD - EVENT - SECTION". Songs
   added from Spotify carry their track id (no lookup); others resolve by ISRC
   then title/artist search via the app token. */

export type SpotifyExportResult = {
  section: string;
  url?: string;
  added?: number;
  total?: number;
  unmatched?: string[];
  error?: string;
};

type SongRow = { provider: string; provider_id: string | null; isrc: string | null; title: string; artist: string | null };

async function resolveTrackId(song: SongRow): Promise<string | null> {
  if (song.provider === "spotify" && song.provider_id) return song.provider_id;
  if (song.isrc) {
    const r = await searchMusic(`isrc:${song.isrc}`, { providers: ["spotify"], limit: 1 });
    if (r.results[0]?.providerId) return r.results[0].providerId;
  }
  const q = [song.title, song.artist].filter(Boolean).join(" ").trim();
  if (!q) return null;
  const r = await searchMusic(q, { providers: ["spotify"], limit: 1 });
  return r.results[0]?.providerId ?? null;
}

export async function exportSectionsToSpotify(
  eventId: string,
  sectionIds: string[],
): Promise<{ needsConnect?: boolean; needsReconnect?: boolean; results?: SpotifyExportResult[]; error?: string }> {
  await requireModule("events", "view", { mode: "throw" });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You're not signed in." };
  if (!sectionIds.length) return { error: "Pick at least one section to export." };

  const conn = await getSpotifyConnection(user.id);
  if (!conn.connected) return { needsConnect: true };
  if (!conn.canWrite) return { needsReconnect: true };

  const admin = createAdminClient();
  const { data: ev } = await admin.from("events").select("name, event_date").eq("id", eventId).maybeSingle();
  if (!ev) return { error: "Event not found." };

  // Date prefix = the event date (MM/DD); falls back to today if unset.
  const d = ev.event_date ? new Date(`${ev.event_date}T00:00:00`) : new Date();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  const eventName = (ev.name as string) ?? "Event";

  const results: SpotifyExportResult[] = [];
  for (const sectionId of sectionIds) {
    const { data: section } = await admin
      .from("planning_sections")
      .select("title")
      .eq("id", sectionId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!section) continue;
    const title = (section.title as string) ?? "Section";

    const { data: songs } = await admin
      .from("planning_songs")
      .select("provider, provider_id, isrc, title, artist")
      .eq("section_id", sectionId)
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });

    const rows = (songs ?? []) as SongRow[];
    if (!rows.length) {
      results.push({ section: title, error: "No songs in this section." });
      continue;
    }

    const uris: string[] = [];
    const unmatched: string[] = [];
    const seen = new Set<string>();
    for (const s of rows) {
      const id = await resolveTrackId(s);
      if (id && !seen.has(id)) {
        seen.add(id);
        uris.push(`spotify:track:${id}`);
      } else if (!id) {
        unmatched.push([s.title, s.artist].filter(Boolean).join(" — "));
      }
    }

    const name = `${mmdd} - ${eventName} - ${title}`;
    const pl = await createSpotifyPlaylist(user.id, name, `Exported from XOS · ${eventName}`.trim());
    if ("error" in pl) {
      results.push({
        section: title,
        error: pl.error === "scope" ? "Reconnect Spotify to allow creating playlists." : "Couldn't create the playlist.",
      });
      continue;
    }
    const ok = await addTracksToSpotifyPlaylist(user.id, pl.id, uris);
    results.push({
      section: title,
      url: pl.url,
      added: ok ? uris.length : 0,
      total: rows.length,
      unmatched,
      ...(ok ? {} : { error: "Playlist created but adding some tracks failed — try again." }),
    });
  }

  return { results };
}
