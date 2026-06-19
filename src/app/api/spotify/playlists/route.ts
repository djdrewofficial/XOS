import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/apiAuth";
import { listUserPlaylists } from "@/lib/spotifyAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { userId } = await resolveApiUser(request);
  if (!userId) return NextResponse.json({ playlists: [] }, { status: 401 });
  return NextResponse.json({ playlists: await listUserPlaylists(userId) });
}
