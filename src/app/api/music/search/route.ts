import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/apiAuth";
import { searchMusic, type MusicProvider } from "@/lib/music";

export const dynamic = "force-dynamic";

/* Music search for the planner's "Add songs" popover. Any signed-in user
   (staff or client/guest) may search; results are normalized across
   Spotify / Apple Music / YouTube by src/lib/music.ts. */

const VALID: MusicProvider[] = ["spotify", "apple", "youtube"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [], providers: {} });

  const { userId } = await resolveApiUser(request);
  if (!userId) return NextResponse.json({ results: [], providers: {} }, { status: 401 });

  const requested = (searchParams.get("providers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is MusicProvider => (VALID as string[]).includes(s));

  const result = await searchMusic(q, {
    providers: requested.length ? requested : undefined,
    limit: 24,
  });

  return NextResponse.json(result);
}
