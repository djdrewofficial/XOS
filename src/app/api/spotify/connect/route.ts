import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildAuthUrl,
  signState,
  spotifyRedirectUri,
  makeOAuthNonce,
  SPOTIFY_NONCE_COOKIE,
} from "@/lib/spotifyAuth";

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
  // Optional explicit return path (e.g. staff exporting from /events/[id]); when
  // absent the callback falls back to the couple planner.
  const returnTo = searchParams.get("returnTo") ?? undefined;
  const returnPath = returnTo && returnTo.startsWith("/") ? returnTo : undefined;
  const redirectUri = spotifyRedirectUri(origin);
  // Bind this flow to the browser with an httpOnly nonce cookie the callback
  // re-checks — defeats account-linking CSRF (replaying someone else's state).
  // Only possible when the callback shares this origin (always so in prod); in
  // the dev cross-origin setup (localhost → 127.0.0.1) the cookie can't travel,
  // so we skip the nonce and fall back to the HMAC alone.
  const sameOrigin = new URL(redirectUri).origin === origin;
  const nonce = sameOrigin ? makeOAuthNonce() : undefined;
  // `ret` = the origin the user is actually on, so we can bounce them back there
  // (the callback may land on a different registered origin, e.g. 127.0.0.1 dev).
  const state = signState({ uid: user.id, eventId, section, ret: origin, returnPath, nonce });
  const res = NextResponse.redirect(buildAuthUrl(redirectUri, state));
  if (nonce) {
    res.cookies.set(SPOTIFY_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // sent on Spotify's top-level GET redirect back to us
      path: "/api/spotify",
      maxAge: 600, // 10 min to complete the authorize round-trip
    });
  }
  return res;
}
