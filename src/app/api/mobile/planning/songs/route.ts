import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { lookupMobileAccountKind } from "@/lib/mobileCouple";
import { resolveEventRole } from "@/lib/planning";
import { addPlaylistSong, removePlaylistSong, reorderPlaylistSongs } from "@/lib/mobilePlaylists";
import { isUuid } from "@/lib/ugcModeration";

/* Mobile playlist song mutations (add / remove / reorder).
   Hosts + staff + guests (on guest_enabled sections) per existing RLS.
   Staff must hold events=edit. JWT-verified via /api/mobile/. */

function userClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rls = userClient(token);
  const { data: userData, error: userErr } = await rls.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = userData.user.id;

  const body = await req.json().catch(() => null);
  const action = body?.action as string | undefined;
  const eventId = String(body?.eventId ?? "");
  if (!eventId || !isUuid(eventId) || !action) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const accountType = await lookupMobileAccountKind(rls, uid);
  if (!accountType) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const role = await resolveEventRole(rls, uid, accountType, eventId);
  if (role !== "staff" && role !== "host" && role !== "guest") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (role === "staff") {
    const denied = await requireMobileStaffModule(rls, token, "events", "edit");
    if (denied) return denied;
  }

  if (action === "add") {
    const song = body.song as Record<string, unknown> | undefined;
    const result = await addPlaylistSong(rls, {
      eventId,
      userId: uid,
      song: {
        sectionId: String(song?.sectionId ?? body.sectionId ?? ""),
        title: String(song?.title ?? ""),
        artist: (song?.artist as string | null | undefined) ?? null,
        note: (song?.note as string | null | undefined) ?? null,
        externalUrl: (song?.externalUrl as string | null | undefined) ?? null,
        provider: (song?.provider as "spotify" | "apple" | "youtube" | "manual" | undefined) ?? "manual",
        providerId: (song?.providerId as string | null | undefined) ?? null,
        album: (song?.album as string | null | undefined) ?? null,
        artworkUrl: (song?.artworkUrl as string | null | undefined) ?? null,
        durationMs: typeof song?.durationMs === "number" ? song.durationMs : null,
        previewUrl: (song?.previewUrl as string | null | undefined) ?? null,
        isrc: (song?.isrc as string | null | undefined) ?? null,
      },
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, id: result.id });
  }

  if (action === "remove") {
    const songId = String(body.songId ?? "");
    const result = await removePlaylistSong(rls, { eventId, userId: uid, songId });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  }

  if (action === "reorder") {
    const sectionId = String(body.sectionId ?? "");
    const orderedIds: string[] = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];
    const result = await reorderPlaylistSongs(rls, { eventId, sectionId, orderedIds });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
