import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/apiAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRateLimited, recordRateHit } from "@/lib/rateLimit";
import { searchMusic, resolveYouTubeUrl, parseYouTubeId, type MusicProvider } from "@/lib/music";

export const dynamic = "force-dynamic";

const MINUTE = 60 * 1000;
const MAX_PER_USER_PER_MIN = 60; // generous for debounced typing; caps scripted quota abuse

/* Music search for the planner's "Add songs" popover. Any signed-in user
   (staff or client/guest) may search. YouTube is intentionally excluded from
   open search (too many messy results) — but a pasted YouTube *link* still
   resolves to a single track so clients can add a specific video. Normalized
   across Spotify / Apple Music by src/lib/music.ts. */

// YouTube is not a searchable provider here — only resolvable via a pasted link.
const VALID: MusicProvider[] = ["spotify", "apple"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [], providers: {} });

  const { userId } = await resolveApiUser(request);
  if (!userId) return NextResponse.json({ results: [], providers: {} }, { status: 401 });

  // Per-user throttle before any external (Spotify/Apple/YouTube) call, so one
  // signed-in client can't loop this to burn provider quota.
  const admin = createAdminClient();
  if (await isRateLimited(admin, "music_search:user", userId, MAX_PER_USER_PER_MIN, MINUTE)) {
    return NextResponse.json({ results: [], providers: {}, error: "rate_limited" }, { status: 429 });
  }
  await recordRateHit(admin, "music_search:user", userId, MINUTE);

  // A pasted YouTube URL resolves to that one video — never an open YouTube search.
  if (parseYouTubeId(q)) {
    const track = await resolveYouTubeUrl(q);
    return NextResponse.json({ results: track ? [track] : [], providers: {} });
  }

  const requested = (searchParams.get("providers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is MusicProvider => (VALID as string[]).includes(s));

  const result = await searchMusic(q, {
    providers: requested.length ? requested : VALID,
    limit: 24,
  });

  return NextResponse.json(result);
}
