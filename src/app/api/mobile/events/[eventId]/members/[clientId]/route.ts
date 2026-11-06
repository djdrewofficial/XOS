import { NextResponse } from "next/server";
import { accessResponse, isUuid, requireCoupleHost } from "@/lib/mobileCouple";
import { removeCoupleMember } from "@/lib/eventAccessServer";

/* Remove another couple member. The contract holder cannot be removed. */

export async function DELETE(req: Request, { params }: { params: Promise<{ eventId: string; clientId: string }> }) {
  const { eventId, clientId } = await params;
  if (!isUuid(eventId) || !isUuid(clientId)) return NextResponse.json({ error: "That person was not found." }, { status: 404 });
  const caller = await requireCoupleHost(req, eventId);
  if (caller instanceof NextResponse) return caller;
  try {
    return NextResponse.json(await removeCoupleMember({ eventId, clientId, userId: caller.userId }));
  } catch (err) {
    return accessResponse(err);
  }
}
