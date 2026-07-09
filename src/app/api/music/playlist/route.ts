import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/apiAuth";
import {
  parseSpotifyPlaylistId,
  getSpotifyPlaylistTracks,
  parseAppleMusicPlaylistId,
  getAppleMusicPlaylistTracks,
} from "@/lib/music";

export const dynamic = "force-dynamic";

/* Import a PUBLIC playlist by pasted link — Spotify OR Apple Music, auto-detected
   from the URL. Both are read with XOS's own credentials (Spotify
   client_credentials / an Apple developer token), so neither needs a user login
   and neither is gated by Spotify's extended-quota approval or an Apple Music
   subscription. Any signed-in user may call it.

   Error codes: bad_link (not a recognized playlist URL), not_found (deleted/wrong
   id/private), restricted (private, or a playlist those app creds can't read),
   unconfigured (that provider's keys missing). */
export async function GET(request: Request) {
  const { userId } = await resolveApiUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = new URL(request.url).searchParams.get("url") ?? "";

  // Apple ids (pl.…) and Spotify ids (22 base62 chars) don't collide, so order
  // only matters for disambiguation — check Apple first, then Spotify.
  const apple = parseAppleMusicPlaylistId(raw);
  const spotifyId = apple ? null : parseSpotifyPlaylistId(raw);
  if (!apple && !spotifyId) return NextResponse.json({ error: "bad_link" }, { status: 400 });

  const provider = apple ? "apple" : "spotify";
  const result = apple
    ? await getAppleMusicPlaylistTracks(apple.id, apple.storefront)
    : await getSpotifyPlaylistTracks(spotifyId!);

  if (result === null) return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 403 });
  }
  return NextResponse.json({ ok: true, provider, name: result.name, tracks: result.tracks });
}
