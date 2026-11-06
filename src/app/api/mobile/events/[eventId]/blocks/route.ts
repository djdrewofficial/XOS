import { NextResponse } from "next/server";
import { UGC_ERRORS, isUuid } from "@/lib/ugcModeration";
import { createBlock, listBlocks } from "@/lib/ugcModerationServer";

/* GET  /api/mobile/events/:eventId/blocks → { blockedUserIds }
   POST /api/mobile/events/:eventId/blocks { userId }
   201 { ok, userId, alreadyBlocked: false }
   200 { ok, userId, alreadyBlocked: true } */

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
