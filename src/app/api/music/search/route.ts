import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchMusic, type MusicProvider } from "@/lib/music";

/* Music search for the planner's "Add songs" popover. Any signed-in user
   (staff or client/guest) may search; results are normalized across
   Spotify / Apple Music / YouTube by src/lib/music.ts. */

const VALID: MusicProvider[] = ["spotify", "apple", "youtube"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [], providers: {} });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ results: [], providers: {} }, { status: 401 });

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
