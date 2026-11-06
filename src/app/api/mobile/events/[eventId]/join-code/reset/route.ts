import { NextResponse } from "next/server";
import { resetJoinCode } from "@/lib/eventAccessServer";
import { accessResponse, isUuid, requireCoupleHost } from "@/lib/mobileCouple";

/* POST { code, expiresAt, eventId }. The previous code stops working. */

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const caller = await requireCoupleHost(req, eventId);
  if (caller instanceof NextResponse) return caller;
  try {
    return NextResponse.json(await resetJoinCode(eventId, caller.userId));
  } catch (err) {
    return accessResponse(err);
  }
}
