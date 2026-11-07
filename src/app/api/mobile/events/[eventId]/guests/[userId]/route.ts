import { NextResponse } from "next/server";
import { UGC_ERRORS, isUuid } from "@/lib/ugcModeration";
import { removeGuest } from "@/lib/ugcModerationServer";

/* DELETE /api/mobile/events/:eventId/guests/:userId
   Host or staff removes a guest membership (event_app_members role = guest).
   200 { ok, userId, access: "none" | "other" }
   access "other" means a legacy guest row or a client link still grants entry. */

export async function DELETE(req: Request, { params }: { params: Promise<{ eventId: string; userId: string }> }) {
  const { eventId, userId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });
  if (!isUuid(userId)) return NextResponse.json({ error: UGC_ERRORS.guestNotFound }, { status: 404 });
  return removeGuest(req, eventId, userId);
}
