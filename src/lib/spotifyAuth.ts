/* Spotify user OAuth (Authorization Code) so couples connect their own Spotify
   and import private playlists. Server-only. Tokens stored in spotify_accounts
   via the service-role client; access tokens auto-refresh. */
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const SPOTIFY_SCOPES =
  "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";

function creds() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Spotify keys not configured");
  return { id, secret };
}

/** The redirect URI used for both authorize + token exchange. Configurable via
    SPOTIFY_REDIRECT_URI (set it to the 127.0.0.1 callback in dev, since Spotify
    rejects "localhost"); falls back to the request origin (works in prod where
    the app + callback share the https domain). */
export function spotifyRedirectUri(origin: string): string {
  return process.env.SPOTIFY_REDIRECT_URI || `${origin}/api/spotify/callback`;
}

// ── CSRF-safe state (carries who/where, HMAC-signed) ──
// The HMAC stops tampering, but a signed state alone isn't tied to the browser
// that started the flow — so a state minted in one session could be replayed in
// another (account-linking CSRF). The web flow additionally binds the state to
// an httpOnly `nonce` cookie set at initiation and re-checked in the callback.
type StatePayload = { uid: string; eventId: string; section?: string; ret?: string; mobile?: boolean; returnPath?: string; nonce?: string };
const stateKey = () => process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "xos-spotify";

/** httpOnly cookie holding the per-flow OAuth nonce (web flow only). */
export const SPOTIFY_NONCE_COOKIE = "sp_oauth_nonce";

/** A fresh unguessable nonce to bind one connect→callback round-trip. */
export function makeOAuthNonce(): string {
  return randomBytes(18).toString("base64url");
}

/** Constant-time check that the callback's cookie nonce matches the state's.
    Returns true when the state carries no nonce (the dev cross-origin flow, where
    connect + callback are on different hosts and can't share a cookie — there is
    nothing to bind). A state WITH a nonce (every prod web flow) must match. */
export function nonceMatches(cookieNonce: string | undefined, stateNonce: string | undefined): boolean {
  if (!stateNonce) return true;
  if (!cookieNonce) return false;
  const a = Buffer.from(cookieNonce);
  const b = Buffer.from(stateNonce);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signState(p: StatePayload): string {
  const data = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(data).digest("base64url");
  return `${data}.${sig}`;
}
export function verifyState(state: string): StatePayload | null {
  const [data, sig] = state.split(".");
  if (!data || !sig) return null;
  const expect = createHmac("sha256", stateKey()).update(data).digest("base64url");
  if (sig !== expect) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const { id } = creds();
  const p = new URLSearchParams({
    response_type: "code",
    client_id: id,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
    show_dialog: "false",
  });
  return `https://accounts.spotify.com/authorize?${p.toString()}`;
}

async function tokenRequest(body: Record<string, string>) {
  const { id, secret } = creds();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`spotify token ${res.status}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

/** Exchange the auth code, fetch the user's profile, and persist the connection. */
export async function exchangeAndStore(code: string, redirectUri: string, userId: string): Promise<boolean> {
  const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  let spotifyUserId: string | null = null;
  let displayName: string | null = null;
  try {
    const me = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (me.ok) {
      const j = (await me.json()) as { id?: string; display_name?: string };
      spotifyUserId = j.id ?? null;
      displayName = j.display_name ?? null;
    }
  } catch {
    /* profile is best-effort */
  }
  const admin = createAdminClient();
  const { error } = await admin.from("spotify_accounts").upsert(
    {
      auth_user_id: userId,
      spotify_user_id: spotifyUserId,
      display_name: displayName,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? "",
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      scope: tok.scope ?? SPOTIFY_SCOPES,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "auth_user_id" },
  );
  return !error;
}

/** Return a valid access token for the user, refreshing if needed. null = not connected. */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("spotify_accounts").select("*").eq("auth_user_id", userId).maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() > Date.now() + 30_000) return data.access_token;
  if (!data.refresh_token) return null;
  try {
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: data.refresh_token });
    await admin
      .from("spotify_accounts")
      .update({
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? data.refresh_token,
        expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("auth_user_id", userId);
    return tok.access_token;
  } catch {
    return null;
  }
}

export async function getSpotifyConnection(
  userId: string,
): Promise<{ connected: boolean; displayName: string | null; canWrite: boolean }> {
  const admin = createAdminClient();
  const { data } = await admin.from("spotify_accounts").select("display_name, scope").eq("auth_user_id", userId).maybeSingle();
  // canWrite = the stored grant includes playlist-modify. Accounts connected
  // before write scopes existed will be read-only until they reconnect.
  const canWrite = !!data && ((data.scope as string | null) ?? "").includes("playlist-modify");
  return { connected: !!data, displayName: data?.display_name ?? null, canWrite };
}

/** The user's Spotify user id (needed to create playlists). Cached on the row;
    falls back to a /v1/me lookup and backfills. */
async function spotifyUserId(userId: string, token: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("spotify_accounts").select("spotify_user_id").eq("auth_user_id", userId).maybeSingle();
  if (data?.spotify_user_id) return data.spotify_user_id as string;
  const me = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!me.ok) return null;
  const j = (await me.json()) as { id?: string };
  const id = j.id ?? null;
  if (id) await admin.from("spotify_accounts").update({ spotify_user_id: id }).eq("auth_user_id", userId);
  return id;
}

/** Create a private playlist in the user's own Spotify account. */
export async function createSpotifyPlaylist(
  userId: string,
  name: string,
  description: string,
): Promise<{ id: string; url: string } | { error: "not_connected" | "no_profile" | "scope" | "failed" }> {
  const token = await getValidAccessToken(userId);
  if (!token) return { error: "not_connected" };
  const sid = await spotifyUserId(userId, token);
  if (!sid) return { error: "no_profile" };
  const res = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(sid)}/playlists`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.slice(0, 100), description: description.slice(0, 300), public: false }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) return { error: "scope" };
  if (!res.ok) return { error: "failed" };
  const j = (await res.json()) as { id: string; external_urls?: { spotify?: string } };
  return { id: j.id, url: j.external_urls?.spotify ?? `https://open.spotify.com/playlist/${j.id}` };
}

/** Add track URIs (spotify:track:ID) to a playlist, 100 per request. */
export async function addTracksToSpotifyPlaylist(userId: string, playlistId: string, uris: string[]): Promise<boolean> {
  if (!uris.length) return true;
  const token = await getValidAccessToken(userId);
  if (!token) return false;
  for (let i = 0; i < uris.length; i += 100) {
    const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
      cache: "no-store",
    });
    if (!res.ok) return false;
  }
  return true;
}

export async function disconnectSpotify(userId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("spotify_accounts").delete().eq("auth_user_id", userId);
}

// ── Catalog/library helpers (used by the import UI) ──
export interface SpotifyPlaylistLite {
  id: string;
  name: string;
  image: string | null;
  trackCount: number;
  owner: string | null;
}

export async function listUserPlaylists(userId: string): Promise<SpotifyPlaylistLite[]> {
  const token = await getValidAccessToken(userId);
  if (!token) return [];
  const out: SpotifyPlaylistLite[] = [];
  let url: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) break;
    const j = (await res.json()) as { items: SpotifyApiPlaylist[]; next: string | null };
    for (const p of j.items ?? []) {
      if (!p) continue;
      out.push({
        id: p.id,
        name: p.name,
        image: p.images?.[0]?.url ?? null,
        trackCount: p.tracks?.total ?? 0,
        owner: p.owner?.display_name ?? null,
      });
    }
    url = j.next;
    if (out.length >= 200) break;
  }
  return out;
}

export interface SpotifyTrackLite {
  providerId: string;
  isrc: string | null;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  previewUrl: string | null;
  externalUrl: string | null;
}

export async function getPlaylistTracks(userId: string, playlistId: string): Promise<SpotifyTrackLite[]> {
  const token = await getValidAccessToken(userId);
  if (!token) return [];
  const out: SpotifyTrackLite[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,duration_ms,preview_url,external_ids,external_urls,artists(name),album(name,images)))`;
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) break;
    const j = (await res.json()) as { items: { track: SpotifyApiTrack | null }[]; next: string | null };
    for (const it of j.items ?? []) {
      const t = it.track;
      if (!t || !t.id) continue;
      out.push({
        providerId: t.id,
        isrc: t.external_ids?.isrc ?? null,
        title: t.name,
        artist: t.artists?.map((a) => a.name).join(", ") ?? "",
        album: t.album?.name ?? null,
        artworkUrl: t.album?.images?.[0]?.url ?? null,
        durationMs: t.duration_ms ?? null,
        previewUrl: t.preview_url ?? null,
        externalUrl: t.external_urls?.spotify ?? null,
      });
    }
    url = j.next;
    if (out.length >= 500) break;
  }
  return out;
}

/** Like getPlaylistTracks but returns null on auth/fetch failure (vs [] for a
    genuinely empty playlist). The live-sync uses this so a transient error never
    removes the section's songs. */
export async function fetchPlaylistTracksStrict(userId: string, playlistId: string): Promise<SpotifyTrackLite[] | null> {
  const token = await getValidAccessToken(userId);
  if (!token) return null;
  const out: SpotifyTrackLite[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,duration_ms,preview_url,external_ids,external_urls,artists(name),album(name,images)))`;
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return null; // fail closed — caller skips reconciliation
    const j = (await res.json()) as { items: { track: SpotifyApiTrack | null }[]; next: string | null };
    for (const it of j.items ?? []) {
      const t = it.track;
      if (!t || !t.id) continue;
      out.push({
        providerId: t.id,
        isrc: t.external_ids?.isrc ?? null,
        title: t.name,
        artist: t.artists?.map((a) => a.name).join(", ") ?? "",
        album: t.album?.name ?? null,
        artworkUrl: t.album?.images?.[0]?.url ?? null,
        durationMs: t.duration_ms ?? null,
        previewUrl: t.preview_url ?? null,
        externalUrl: t.external_urls?.spotify ?? null,
      });
    }
    url = j.next;
    if (out.length >= 500) break;
  }
  return out;
}

interface SpotifyApiPlaylist {
  id: string;
  name: string;
  images?: { url: string }[];
  tracks?: { total: number };
  owner?: { display_name?: string };
}
interface SpotifyApiTrack {
  id: string;
  name: string;
  duration_ms?: number;
  preview_url?: string | null;
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
  artists?: { name: string }[];
  album?: { name?: string; images?: { url: string }[] };
}
