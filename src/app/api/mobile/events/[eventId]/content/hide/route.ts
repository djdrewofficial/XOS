import { NextResponse } from "next/server";
import { UGC_ERRORS, isUuid } from "@/lib/ugcModeration";
import { hideContent } from "@/lib/ugcModerationServer";

/* POST /api/mobile/events/:eventId/content/hide
   Body: { targetType, targetId, targetUserId? }
   Soft-hides. Guests can hide only their own. Hosts can hide a guest's
   content, their own, and shared couple fields. 200 { ok, targetType, targetId, hiddenAt } */

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });
  return hideContent(req, eventId);
}
