import { NextResponse } from "next/server";
import { UGC_ERRORS, isUuid } from "@/lib/ugcModeration";
import { listEventContent } from "@/lib/ugcModerationServer";

/* GET /api/mobile/events/:eventId/content
   Songs, likes, answers, notes, and the other member-visible fields.
   Hidden rows and blocked authors are omitted unless the caller is staff.
   Staff rows include hidden: true so removed content stays reviewable. */

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });
  return listEventContent(req, eventId);
}
