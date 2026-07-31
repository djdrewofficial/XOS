import { NextResponse } from "next/server";
import {
  exchangeAndStore,
  verifyState,
  spotifyRedirectUri,
  nonceMatches,
  SPOTIFY_NONCE_COOKIE,
} from "@/lib/spotifyAuth";

/** Read a single cookie value off the incoming request. */
function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/* Spotify redirects here after the user authorizes. We identify the user from
   the HMAC-signed state (so this works even if the callback lands on a different
   registered origin than where they're logged in — e.g. 127.0.0.1 in dev), store
   their tokens, and bounce them back to the planner on their original origin. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const parsed = state ? verifyState(state) : null;

  // Mobile app flow: bounce back into the app via its deep link so
  // WebBrowser.openAuthSessionAsync resolves and the app refreshes its status.
  // (No cookie is shared with the native in-app browser, so this leg stays
  // HMAC-only; see the audit note in spotifyAuth.ts.)
  if (parsed?.mobile) {
    const ret = parsed.ret || "xpressclient://spotify-callback";
    const sep = ret.includes("?") ? "&" : "?";
    if (error || !code) return NextResponse.redirect(`${ret}${sep}spotify=error`);
    const ok = await exchangeAndStore(code, spotifyRedirectUri(origin), parsed.uid);
    return NextResponse.redirect(`${ret}${sep}spotify=${ok ? "connected" : "error"}`);
  }

  const ret = parsed?.ret || origin;
  // Explicit return path wins (staff export flow); else the couple planner.
  const back = parsed?.returnPath
    ? `${ret}${parsed.returnPath}`
    : parsed?.eventId
      ? `${ret}/portal/plan/${parsed.eventId}`
      : `${ret}/portal`;

  // Every response clears the one-shot nonce cookie the connect route set.
  const redirect = (url: string) => {
    const res = NextResponse.redirect(url);
    res.cookies.set(SPOTIFY_NONCE_COOKIE, "", { httpOnly: true, path: "/api/spotify", maxAge: 0 });
    return res;
  };

  if (error || !code || !parsed) {
    return redirect(`${back}?spotify=error`);
  }

  // CSRF binding: the web flow set an httpOnly nonce cookie at connect time; it
  // must match the signed state's nonce, so a state minted in another browser
  // can't be replayed to link that person's Spotify to this account.
  if (!nonceMatches(readCookie(request, SPOTIFY_NONCE_COOKIE), parsed.nonce)) {
    return redirect(`${back}?spotify=error`);
  }

  const ok = await exchangeAndStore(code, spotifyRedirectUri(origin), parsed.uid);
  return redirect(`${back}?spotify=${ok ? "connected" : "error"}`);
}
