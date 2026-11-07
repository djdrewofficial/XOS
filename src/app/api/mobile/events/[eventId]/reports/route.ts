import { UGC_ERRORS, isUuid } from "@/lib/ugcModeration";
import { createReport, listMyReports } from "@/lib/ugcModerationServer";
import { NextResponse } from "next/server";

/* POST /api/mobile/events/:eventId/reports
   Body: { targetType, targetId?, targetUserId?, reason, details? }
   201 { id, targetType, targetId, targetUserId, reason, details, status, createdAt, alreadyReported: false }
   200 same shape with alreadyReported: true when this member already has an open report.
   GET returns { reports: [...] } for the signed-in member only. */

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });
  return listMyReports(req, eventId);
}

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });
  return createReport(req, eventId);
}
