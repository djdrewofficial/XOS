import { NextResponse } from "next/server";
import { UGC_ERRORS, isUuid } from "@/lib/ugcModeration";
import { deleteBlock } from "@/lib/ugcModerationServer";

/* DELETE /api/mobile/events/:eventId/blocks/:userId → 200 { ok, userId } */

export async function DELETE(req: Request, { params }: { params: Promise<{ eventId: string; userId: string }> }) {
  const { eventId, userId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });
  return deleteBlock(req, eventId, userId);
}
