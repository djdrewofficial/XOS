import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/apiAuth";
import { getPlaylistTracks } from "@/lib/spotifyAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = (searchParams.get("id") ?? "").trim();
  const { userId } = await resolveApiUser(request);
  if (!userId) return NextResponse.json({ tracks: [] }, { status: 401 });
  if (!id) return NextResponse.json({ tracks: [] });
  return NextResponse.json({ tracks: await getPlaylistTracks(userId, id) });
}
