import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/apiAuth";
import { buildAuthUrl, signState, spotifyRedirectUri } from "@/lib/spotifyAuth";

export const dynamic = "force-dynamic";

/* Mobile Spotify connect: the app (Bearer auth) asks for an authorize URL, opens
   it in an in-app browser, and we deep-link back to `return` after the callback
   stores the user's tokens. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const { userId } = await resolveApiUser(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ret = searchParams.get("return") || "xpressclient://spotify-callback";
  const state = signState({ uid: userId, eventId: "", ret, mobile: true });
  return NextResponse.json({ url: buildAuthUrl(spotifyRedirectUri(origin), state) });
}
