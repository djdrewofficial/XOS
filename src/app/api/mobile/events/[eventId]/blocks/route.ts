import { NextResponse } from "next/server";
import { UGC_ERRORS, isUuid } from "@/lib/ugcModeration";
import { createBlock, listBlocks } from "@/lib/ugcModerationServer";

/* GET  /api/mobile/events/:eventId/blocks
   { blockedUserIds, blocked }
   blockedUserIds is unchanged. blocked is the same ids in the same order:
   { userId, displayName, label, role }.
   label is unique in this list. Use it to choose who to unblock.
   userId is the id for DELETE /blocks/:userId.
   displayName is null when no name is stored on this event, including a person
   who was removed and whose event name is gone. role is null in that case.
   POST { userId } still returns { ok, userId, alreadyBlocked } and now also
   displayName, label, and role for that person, using the same labels as GET.
   No phone, email, or auth metadata. Names are not taken from any other event. */

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });
  return listBlocks(req, eventId);
}

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });
  return createBlock(req, eventId);
}
