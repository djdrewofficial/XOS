import { NextResponse } from "next/server";
import { accessResponse, isUuid, requireCoupleHost } from "@/lib/mobileCouple";
import { listEventAccess } from "@/lib/eventAccessServer";

/* Couple members on this event, plus nothing for guests.
   GET { members, invites } */

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const caller = await requireCoupleHost(req, eventId);
  if (caller instanceof NextResponse) return caller;
  try {
    return NextResponse.json(await listEventAccess(eventId));
  } catch (err) {
    return accessResponse(err);
  }
}
