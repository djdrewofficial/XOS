/* Unified music search — one normalized shape across Spotify, Apple Music and
   YouTube. Server-only (uses secret API keys; never import from a client file).

   Design goals:
   - One MusicTrack shape so the planner UI never branches on provider.
   - Each provider is independent and optional: missing creds => that provider
     reports "unconfigured" and the others still return results. Nothing throws
     to the caller; a provider failure is captured per-provider.
   - Apple Music is wired but dormant until APPLE_MUSIC_* env vars are added
     (Drew's developer approval pending) — no rework needed when they land.

   Env (all optional, all server-side):
     SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
     YOUTUBE_API_KEY
     APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY  (.p8 contents)
*/
import "server-only";

export type MusicProvider = "spotify" | "apple" | "youtube";

export interface MusicTrack {
  provider: MusicProvider;
  providerId: string;
  isrc?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  artworkUrl?: string | null;
  durationMs?: number | null;
  previewUrl?: string | null;
  externalUrl?: string | null;
}

export type ProviderStatus = "ok" | "unconfigured" | "error";

export interface MusicSearchResult {
  results: MusicTrack[];
  providers: Record<MusicProvider, ProviderStatus>;
}

const ALL_PROVIDERS: MusicProvider[] = ["spotify", "apple", "youtube"];

/** Search every (requested) provider in parallel and return a flat, normalized,
    interleaved list. Order: results are grouped per provider then round-robined
    so the top of the list isn't dominated by a single source. */
export async function searchMusic(
  query: string,
  opts: { providers?: MusicProvider[]; limit?: number } = {},
): Promise<MusicSearchResult> {
  const q = query.trim();
  const providers = opts.providers?.length ? opts.providers : ALL_PROVIDERS;
  const limit = opts.limit ?? 20;

  const status: Record<MusicProvider, ProviderStatus> = {
    spotify: "unconfigured",
    apple: "unconfigured",
    youtube: "unconfigured",
  };

  if (!q) return { results: [], providers: status };

  const runners: Record<MusicProvider, (q: string, n: number) => Promise<MusicTrack[]>> = {
    spotify: searchSpotify,
    apple: searchAppleMusic,
    youtube: searchYouTube,
  };

  const per = await Promise.all(
    providers.map(async (p) => {
      try {
        const tracks = await runners[p](q, limit);
        status[p] = tracks === UNCONFIGURED ? "unconfigured" : "ok";
        return tracks === UNCONFIGURED ? [] : tracks;
      } catch (err) {
        console.error(`[music] ${p} search failed:`, err);
        status[p] = "error";
        return [] as MusicTrack[];
      }
    }),
  );

  return { results: interleave(per).slice(0, limit), providers: status };
}

// Sentinel a provider returns when its creds aren't configured.
const UNCONFIGURED = Symbol("unconfigured") as unknown as MusicTrack[];

function interleave(lists: MusicTrack[][]): MusicTrack[] {
  const out: MusicTrack[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}

// ───────────────────────────── Spotify ─────────────────────────────
// Client-Credentials flow (server-to-server, no user login) for catalog search.

let spotifyToken: { value: string; expiresAt: number } | null = null;

async function spotifyAccessToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (spotifyToken && spotifyToken.expiresAt > Date.now() + 5_000) {
    return spotifyToken.value;
  }
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`spotify token ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  spotifyToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return spotifyToken.value;
}

async function searchSpotify(q: string, limit: number): Promise<MusicTrack[]> {
  const token = await spotifyAccessToken();
  if (!token) return UNCONFIGURED;

  const url = `https://api.spotify.com/v1/search?type=track&limit=${limit}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`spotify search ${res.status}`);
  const json = (await res.json()) as SpotifySearch;

  return (json.tracks?.items ?? []).map((t) => ({
    provider: "spotify" as const,
    providerId: t.id,
    isrc: t.external_ids?.isrc ?? null,
    title: t.name,
    artist: t.artists?.map((a) => a.name).join(", ") ?? "",
    album: t.album?.name ?? null,
    artworkUrl: pickSpotifyArt(t.album?.images),
    durationMs: t.duration_ms ?? null,
    previewUrl: t.preview_url ?? null, // often null for new apps; fallback elsewhere
    externalUrl: t.external_urls?.spotify ?? null,
  }));
}

function pickSpotifyArt(images?: { url: string; width: number }[]): string | null {
  if (!images?.length) return null;
  // Prefer a small-ish thumbnail (~300px) for list rendering.
  const sorted = [...images].sort((a, b) => a.width - b.width);
  return (sorted.find((i) => i.width >= 200) ?? sorted[sorted.length - 1]).url;
}

interface SpotifyTrackObj {
  id?: string;
  name?: string;
  duration_ms?: number;
  preview_url?: string | null;
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
  artists?: { name: string }[];
  album?: { name?: string; images?: { url: string; width: number }[] };
}

function spotifyTrackToMusic(t: SpotifyTrackObj): MusicTrack {
  return {
    provider: "spotify",
    providerId: t.id ?? "",
    isrc: t.external_ids?.isrc ?? null,
    title: t.name ?? "",
    artist: t.artists?.map((a) => a.name).join(", ") ?? "",
    album: t.album?.name ?? null,
    artworkUrl: pickSpotifyArt(t.album?.images),
    durationMs: t.duration_ms ?? null,
    previewUrl: t.preview_url ?? null,
    externalUrl: t.external_urls?.spotify ?? null,
  };
}

/** Pull a Spotify playlist id from a share URL / URI / bare id. */
export function parseSpotifyPlaylistId(input: string): string | null {
  const s = (input ?? "").trim();
  const uri = s.match(/spotify:playlist:([A-Za-z0-9]+)/);
  if (uri) return uri[1];
  const url = s.match(/open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/([A-Za-z0-9]+)/i);
  if (url) return url[1];
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s;
  return null;
}

/** Read a PUBLIC Spotify playlist's tracks with the app (client-credentials)
    token — no user login, so it isn't gated by extended-quota approval. Returns
    { error } for private/not-found/dev-mode-restricted playlists, or null when
    Spotify isn't configured. */
export async function getSpotifyPlaylistTracks(
  playlistId: string,
  max = 250,
): Promise<{ name: string | null; tracks: MusicTrack[] } | { error: "restricted" | "not_found" } | null> {
  const token = await spotifyAccessToken();
  if (!token) return null;

  let name: string | null = null;
  try {
    const meta = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (meta.status === 404) return { error: "not_found" };
    if (meta.status === 401 || meta.status === 403) return { error: "restricted" };
    if (meta.ok) name = ((await meta.json()) as { name?: string }).name ?? null;
  } catch {
    /* best-effort name */
  }

  const tracks: MusicTrack[] = [];
  const fields = "next,items(track(id,name,artists(name),album(name,images),duration_ms,preview_url,external_urls,external_ids))";
  let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=${encodeURIComponent(fields)}`;
  while (url && tracks.length < max) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.status === 404) return { error: "not_found" };
    if (res.status === 401 || res.status === 403) return { error: "restricted" };
    if (!res.ok) break;
    const j = (await res.json()) as { next: string | null; items: { track: SpotifyTrackObj | null }[] };
    for (const it of j.items ?? []) {
      if (it.track?.id) tracks.push(spotifyTrackToMusic(it.track));
    }
    url = j.next;
  }
  return { name, tracks };
}

// ───────────────────────────── YouTube ─────────────────────────────
// Data API v3 search (quota-heavy: 100 units/call). Duration isn't in the
// search payload; left null for v1 (a videos.list lookup can fill it later).

async function searchYouTube(q: string, limit: number): Promise<MusicTrack[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return UNCONFIGURED;

  const url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
    `&videoCategoryId=10&maxResults=${Math.min(limit, 25)}` +
    `&q=${encodeURIComponent(q)}&key=${key}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`youtube search ${res.status}`);
  const json = (await res.json()) as YouTubeSearch;

  return (json.items ?? [])
    .filter((it): it is YouTubeItem & { id: { videoId: string } } => Boolean(it.id?.videoId))
    .map((it) => ({
      provider: "youtube" as const,
      providerId: it.id.videoId,
      title: decodeHtml(it.snippet?.title ?? ""),
      artist: decodeHtml(it.snippet?.channelTitle ?? ""),
      album: null,
      artworkUrl:
        it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? null,
      durationMs: null,
      previewUrl: null,
      externalUrl: `https://www.youtube.com/watch?v=${it.id.videoId}`,
    }));
}

const YT_ID_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
/** Pull an 11-char YouTube video id from a pasted URL (watch / youtu.be / shorts / embed). */
export function parseYouTubeId(input: string): string | null {
  const m = input.match(YT_ID_RE);
  return m ? m[1] : null;
}

/** Resolve a pasted YouTube link to a single track via a snippet lookup. Returns
    null if it isn't a YouTube URL or the lookup fails. Lets clients post a YouTube
    link even though YouTube is excluded from open search. */
export async function resolveYouTubeUrl(input: string): Promise<MusicTrack | null> {
  const id = parseYouTubeId(input);
  if (!id) return null;
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}&key=${key}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: { snippet?: YouTubeItem["snippet"] }[] };
    const sn = json.items?.[0]?.snippet;
    if (!sn) return null;
    return {
      provider: "youtube",
      providerId: id,
      title: decodeHtml(sn.title ?? "YouTube video"),
      artist: decodeHtml(sn.channelTitle ?? ""),
      album: null,
      artworkUrl: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? null,
      durationMs: null,
      previewUrl: null,
      externalUrl: `https://www.youtube.com/watch?v=${id}`,
    };
  } catch {
    return null;
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ──────────────────────────── Apple Music ────────────────────────────
// Dormant until APPLE_MUSIC_* are set. Catalog search needs only a developer
// token (a short-lived ES256 JWT signed with the .p8 key) — no user token.
// Implemented behind the env check so it activates the moment creds land.

async function searchAppleMusic(q: string, limit: number): Promise<MusicTrack[]> {
  const token = appleDeveloperToken();
  if (!token) return UNCONFIGURED;

  const storefront = process.env.APPLE_MUSIC_STOREFRONT || "us";
  const url =
    `https://api.music.apple.com/v1/catalog/${storefront}/search` +
    `?types=songs&limit=${Math.min(limit, 25)}&term=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`apple search ${res.status}`);
  const json = (await res.json()) as AppleSearch;

  return (json.results?.songs?.data ?? []).map((s) => ({
    provider: "apple" as const,
    providerId: s.id,
    isrc: s.attributes?.isrc ?? null,
    title: s.attributes?.name ?? "",
    artist: s.attributes?.artistName ?? "",
    album: s.attributes?.albumName ?? null,
    artworkUrl: appleArt(s.attributes?.artwork),
    durationMs: s.attributes?.durationInMillis ?? null,
    previewUrl: s.attributes?.previews?.[0]?.url ?? null,
    externalUrl: s.attributes?.url ?? null,
  }));
}

function appleArt(a?: { url: string }): string | null {
  if (!a?.url) return null;
  return a.url.replace("{w}", "300").replace("{h}", "300");
}

// Cache the signed developer token (valid up to ~6 months; we re-sign hourly to
// stay safe and cheap). Lazily requires a JWT signer only when creds exist.
let appleToken: { value: string; expiresAt: number } | null = null;

function appleDeveloperToken(): string | null {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!teamId || !keyId || !privateKey) return null;

  if (appleToken && appleToken.expiresAt > Date.now() + 60_000) return appleToken.value;

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60; // 1 hour
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: teamId, iat: now, exp }));
  const signingInput = `${header}.${payload}`;

  // Node crypto ES256 over the .p8 EC private key.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createSign } = require("crypto") as typeof import("crypto");
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const der = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  const jwt = `${signingInput}.${der.toString("base64url")}`;

  appleToken = { value: jwt, expiresAt: exp * 1000 };
  return jwt;
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

// ──────────────────────── provider response shapes ────────────────────────
interface SpotifySearch {
  tracks?: {
    items: {
      id: string;
      name: string;
      duration_ms?: number;
      preview_url?: string | null;
      external_ids?: { isrc?: string };
      external_urls?: { spotify?: string };
      artists?: { name: string }[];
      album?: { name?: string; images?: { url: string; width: number }[] };
    }[];
  };
}
interface YouTubeItem {
  id: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: { default?: { url: string }; medium?: { url: string } };
  };
}
interface YouTubeSearch {
  items?: YouTubeItem[];
}
interface AppleSearch {
  results?: {
    songs?: {
      data: {
        id: string;
        attributes?: {
          name?: string;
          artistName?: string;
          albumName?: string;
          isrc?: string;
          durationInMillis?: number;
          url?: string;
          artwork?: { url: string };
          previews?: { url: string }[];
        };
      }[];
    };
  };
}
