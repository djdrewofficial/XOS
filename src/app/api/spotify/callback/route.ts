import { NextResponse } from "next/server";
import { exchangeAndStore, verifyState, spotifyRedirectUri } from "@/lib/spotifyAuth";

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
  if (parsed?.mobile) {
    const ret = parsed.ret || "xpressclient://spotify-callback";
    const sep = ret.includes("?") ? "&" : "?";
    if (error || !code) return NextResponse.redirect(`${ret}${sep}spotify=error`);
    const ok = await exchangeAndStore(code, spotifyRedirectUri(origin), parsed.uid);
    return NextResponse.redirect(`${ret}${sep}spotify=${ok ? "connected" : "error"}`);
  }

  const ret = parsed?.ret || origin;
  const back = parsed?.eventId ? `${ret}/portal/plan/${parsed.eventId}` : `${ret}/portal`;

  if (error || !code || !parsed) {
    return NextResponse.redirect(`${back}?spotify=error`);
  }

  const ok = await exchangeAndStore(code, spotifyRedirectUri(origin), parsed.uid);
  return NextResponse.redirect(`${back}?spotify=${ok ? "connected" : "error"}`);
}
