"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModule } from "@/lib/auth";
import { getSpotifyConnection, createSpotifyPlaylist, addTracksToSpotifyPlaylist } from "@/lib/spotifyAuth";
import { searchMusic } from "@/lib/music";
import { isOpenAIConfigured, chatComplete } from "@/lib/openai";

/* Staff-only Spotify export, two phases:
   1) resolvePlannerTracksForExport — match every song in the chosen sections to a
      Spotify track. YouTube songs (messy titles / channel-as-artist) are first
      cleaned by OpenAI into real title+artist, then searched. Returns candidates
      for the DJ to CONFIRM.
   2) createSpotifyPlaylistsFromConfirmed — takes the DJ-approved track ids and
      creates one playlist per section ("MM/DD - EVENT - SECTION"). */

export type ResolvedCandidate = {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
};
export type ResolvedSong = {
  songId: string;
  originalTitle: string;
  originalArtist: string | null;
  provider: string;
  candidate: ResolvedCandidate | null;
  confidence: "high" | "review"; // high = came from Spotify already; review = matched by search/AI
};
export type ResolvedSection = { sectionId: string; title: string; songs: ResolvedSong[] };

export type SpotifyExportResult = { section: string; url?: string; added?: number; error?: string };

type SongRow = {
  id: string;
  provider: string;
  provider_id: string | null;
  isrc: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  artwork_url: string | null;
};

const MAX_SONGS = 400;

async function requireStaffUser() {
  await requireModule("events", "view", { mode: "throw" });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Ask OpenAI to turn messy YouTube video titles into { title, artist }. Batched
    into one call. Falls back to (title, channel) when AI is off or misbehaves. */
async function aiCleanYouTube(items: { title: string; channel: string | null }[]): Promise<{ title: string; artist: string }[]> {
  const fallback = items.map((i) => ({ title: i.title, artist: i.channel ?? "" }));
  if (!items.length || !isOpenAIConfigured()) return fallback;
  try {
    const payload = items.map((i, idx) => ({ i: idx, videoTitle: i.title, channel: i.channel }));
    const out = await chatComplete([
      {
        role: "system",
        content:
          "You clean YouTube music video titles for matching on Spotify. YouTube titles are messy: they include things like (Official Video), [Lyrics], feat., remaster tags, and the 'channel' is often a label/uploader, NOT the artist. For each item, infer the real SONG TITLE and PRIMARY ARTIST. Output ONLY a JSON array (no prose, no code fences) of objects {\"title\":string,\"artist\":string} in the SAME ORDER as the input.",
      },
      { role: "user", content: JSON.stringify(payload) },
    ]);
    const cleaned = stripFences(out);
    const parsed = JSON.parse(cleaned) as { title?: string; artist?: string }[];
    if (Array.isArray(parsed) && parsed.length === items.length) {
      return parsed.map((p, idx) => ({
        title: (p.title ?? "").toString().trim() || items[idx].title,
        artist: (p.artist ?? "").toString().trim() || items[idx].channel || "",
      }));
    }
  } catch {
    /* fall through to fallback */
  }
  return fallback;
}

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function toCandidate(t: { providerId: string; title: string; artist: string; album?: string | null; artworkUrl?: string | null }): ResolvedCandidate {
  return { trackId: t.providerId, title: t.title, artist: t.artist, album: t.album ?? null, artworkUrl: t.artworkUrl ?? null };
}

async function searchSpotifyOne(query: string): Promise<ResolvedCandidate | null> {
  const q = query.trim();
  if (!q) return null;
  const r = await searchMusic(q, { providers: ["spotify"], limit: 1 });
  const hit = r.results[0];
  return hit?.providerId ? toCandidate(hit) : null;
}

/** Simple bounded-concurrency map so we don't fire hundreds of searches at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function resolvePlannerTracksForExport(
  eventId: string,
  sectionIds: string[],
): Promise<{ needsConnect?: boolean; needsReconnect?: boolean; error?: string; sections?: ResolvedSection[]; truncated?: boolean }> {
  const user = await requireStaffUser();
  if (!user) return { error: "You're not signed in." };
  if (!sectionIds.length) return { error: "Pick at least one section." };

  const conn = await getSpotifyConnection(user.id);
  if (!conn.connected) return { needsConnect: true };
  if (!conn.canWrite) return { needsReconnect: true };

  const admin = createAdminClient();

  // Load sections (in the requested order) + their songs.
  const loaded: { sectionId: string; title: string; songs: SongRow[] }[] = [];
  let count = 0;
  let truncated = false;
  for (const sid of sectionIds) {
    const { data: sec } = await admin.from("planning_sections").select("title").eq("id", sid).eq("event_id", eventId).maybeSingle();
    if (!sec) continue;
    const { data: songs } = await admin
      .from("planning_songs")
      .select("id, provider, provider_id, isrc, title, artist, album, artwork_url")
      .eq("section_id", sid)
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });
    let rows = (songs ?? []) as SongRow[];
    if (count + rows.length > MAX_SONGS) {
      rows = rows.slice(0, Math.max(0, MAX_SONGS - count));
      truncated = true;
    }
    count += rows.length;
    loaded.push({ sectionId: sid, title: (sec.title as string) ?? "Section", songs: rows });
    if (count >= MAX_SONGS) break;
  }

  // Clean all YouTube songs (across every section) in one AI call.
  const ytSongs = loaded.flatMap((s) => s.songs).filter((s) => s.provider === "youtube");
  const cleaned = await aiCleanYouTube(ytSongs.map((s) => ({ title: s.title, channel: s.artist })));
  const ytClean = new Map<string, { title: string; artist: string }>();
  ytSongs.forEach((s, idx) => ytClean.set(s.id, cleaned[idx]));

  const sections: ResolvedSection[] = [];
  for (const s of loaded) {
    const resolved = await mapLimit(s.songs, 6, async (song): Promise<ResolvedSong> => {
      // Already a Spotify track — trust it, no lookup.
      if (song.provider === "spotify" && song.provider_id) {
        return {
          songId: song.id,
          originalTitle: song.title,
          originalArtist: song.artist,
          provider: song.provider,
          candidate: { trackId: song.provider_id, title: song.title, artist: song.artist ?? "", album: song.album, artworkUrl: song.artwork_url },
          confidence: "high",
        };
      }
      let candidate: ResolvedCandidate | null = null;
      // ISRC is the most reliable cross-provider key.
      if (song.isrc) candidate = await searchSpotifyOne(`isrc:${song.isrc}`);
      if (!candidate) {
        const c = song.provider === "youtube" ? ytClean.get(song.id) : null;
        const query = c ? [c.title, c.artist].filter(Boolean).join(" ") : [song.title, song.artist].filter(Boolean).join(" ");
        candidate = await searchSpotifyOne(query);
      }
      return {
        songId: song.id,
        originalTitle: song.title,
        originalArtist: song.artist,
        provider: song.provider,
        candidate,
        confidence: "review",
      };
    });
    sections.push({ sectionId: s.sectionId, title: s.title, songs: resolved });
  }

  return { sections, truncated };
}

export async function createSpotifyPlaylistsFromConfirmed(
  eventId: string,
  picks: { sectionId: string; trackIds: string[] }[],
): Promise<{ needsConnect?: boolean; needsReconnect?: boolean; error?: string; results?: SpotifyExportResult[] }> {
  const user = await requireStaffUser();
  if (!user) return { error: "You're not signed in." };
  const wanted = picks.filter((p) => p.trackIds?.length);
  if (!wanted.length) return { error: "Nothing selected to export." };

  const conn = await getSpotifyConnection(user.id);
  if (!conn.connected) return { needsConnect: true };
  if (!conn.canWrite) return { needsReconnect: true };

  const admin = createAdminClient();
  const { data: ev } = await admin.from("events").select("name, event_date").eq("id", eventId).maybeSingle();
  if (!ev) return { error: "Event not found." };
  const d = ev.event_date ? new Date(`${ev.event_date}T00:00:00`) : new Date();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  const eventName = (ev.name as string) ?? "Event";

  const results: SpotifyExportResult[] = [];
  for (const pick of wanted) {
    const { data: sec } = await admin.from("planning_sections").select("title").eq("id", pick.sectionId).eq("event_id", eventId).maybeSingle();
    if (!sec) continue;
    const title = (sec.title as string) ?? "Section";
    const uris = [...new Set(pick.trackIds)].map((id) => `spotify:track:${id}`);
    const name = `${mmdd} - ${eventName} - ${title}`;
    const pl = await createSpotifyPlaylist(user.id, name, `Exported from XOS · ${eventName}`.trim());
    if ("error" in pl) {
      results.push({ section: title, error: pl.error === "scope" ? "Reconnect Spotify to allow creating playlists." : "Couldn't create the playlist." });
      continue;
    }
    const ok = await addTracksToSpotifyPlaylist(user.id, pl.id, uris);
    results.push({ section: title, url: pl.url, added: ok ? uris.length : 0, ...(ok ? {} : { error: "Some tracks failed to add — try again." }) });
  }
  return { results };
}
