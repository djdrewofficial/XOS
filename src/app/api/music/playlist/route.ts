import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/apiAuth";
import { parseSpotifyPlaylistId, getSpotifyPlaylistTracks } from "@/lib/music";

export const dynamic = "force-dynamic";

/* Import a PUBLIC Spotify playlist by pasted link — read with XOS's app
   credentials (client_credentials), so it needs no user login and isn't gated by
   Spotify's extended-quota approval. Any signed-in user may call it.

   Error codes: bad_link (not a playlist URL), not_found (deleted/wrong id),
   restricted (private, or a Spotify-owned playlist a dev-mode app can't read),
   unconfigured (Spotify keys missing). */
export async function GET(request: Request) {
  const { userId } = await resolveApiUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = new URL(request.url).searchParams.get("url") ?? "";
  const id = parseSpotifyPlaylistId(raw);
  if (!id) return NextResponse.json({ error: "bad_link" }, { status: 400 });

  const result = await getSpotifyPlaylistTracks(id);
  if (result === null) return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 403 });
  }
  return NextResponse.json({ ok: true, name: result.name, tracks: result.tracks });
}
