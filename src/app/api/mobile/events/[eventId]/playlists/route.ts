import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isUuid, UGC_ERRORS } from "@/lib/ugcModeration";
import { lookupMobileAccountKind, requireMobileUser } from "@/lib/mobileCouple";
import { resolveEventRole } from "@/lib/planning";
import { loadEventPlaylists } from "@/lib/mobilePlaylists";

/* GET /api/mobile/events/:eventId/playlists
   Music-tab payload: playlist moments with ordered songs.
   Hosts/staff see all playlists; guests only guest_enabled ones.
   Flat songs + song ideas + do-not-play stay on /content for App Store 1.0. */

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });

  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;
  if (!caller.accountType) {
    return NextResponse.json({ error: UGC_ERRORS.noAccess }, { status: 403 });
  }

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const rls = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const accountType = await lookupMobileAccountKind(rls, caller.userId);
  if (!accountType) return NextResponse.json({ error: UGC_ERRORS.noAccess }, { status: 403 });
  const role = await resolveEventRole(rls, caller.userId, accountType, eventId);
  if (!role) return NextResponse.json({ error: UGC_ERRORS.noAccess }, { status: 403 });

  const result = await loadEventPlaylists(rls, eventId, role);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ playlists: result.playlists });
}
