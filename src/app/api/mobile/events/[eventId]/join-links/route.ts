import { NextResponse } from "next/server";
import { ensureJoinLinks } from "@/lib/eventAccessServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessResponse, isUuid, requireCoupleHost } from "@/lib/mobileCouple";

/* GET { links: [{ role: "host" | "guest", url, expiresAt }] }
   Host only. Creates the two links the first time. */

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const caller = await requireCoupleHost(req, eventId);
  if (caller instanceof NextResponse) return caller;
  try {
    const links = await ensureJoinLinks(createAdminClient(), eventId, caller.userId);
    return NextResponse.json({ links });
  } catch (err) {
    return accessResponse(err);
  }
}
