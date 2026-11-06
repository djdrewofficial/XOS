import { NextResponse } from "next/server";
import { getJoinCode } from "@/lib/eventAccessServer";
import { accessResponse, isUuid, requireCoupleHost } from "@/lib/mobileCouple";

/* GET { code, expiresAt, eventId }. Creates a code if this event does not have a live one. */

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const caller = await requireCoupleHost(req, eventId);
  if (caller instanceof NextResponse) return caller;
  try {
    return NextResponse.json(await getJoinCode(eventId, caller.userId));
  } catch (err) {
    return accessResponse(err);
  }
}
