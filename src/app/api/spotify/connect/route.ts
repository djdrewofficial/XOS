import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthUrl, signState, spotifyRedirectUri } from "@/lib/spotifyAuth";

/* Kick off Spotify user-login. The redirect URI is derived from the request
   origin so dev (http://127.0.0.1:3000) and prod (https://xos.xpressdjs.com)
   both match a registered URI. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const eventId = searchParams.get("eventId") ?? "";
  const section = searchParams.get("section") ?? undefined;
  const redirectUri = spotifyRedirectUri(origin);
  // `ret` = the origin the user is actually on, so we can bounce them back there
  // (the callback may land on a different registered origin, e.g. 127.0.0.1 dev).
  const state = signState({ uid: user.id, eventId, section, ret: origin });
  return NextResponse.redirect(buildAuthUrl(redirectUri, state));
}
