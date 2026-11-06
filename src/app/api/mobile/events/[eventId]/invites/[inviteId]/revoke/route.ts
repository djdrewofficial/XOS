import { NextResponse } from "next/server";
import { revokeEventInvite } from "@/lib/eventAccessServer";
import { accessResponse, isUuid, requireCoupleHost } from "@/lib/mobileCouple";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; inviteId: string }> }) {
  const { eventId, inviteId } = await params;
  if (!isUuid(eventId) || !isUuid(inviteId)) return NextResponse.json({ error: "That invite was not found." }, { status: 404 });
  const caller = await requireCoupleHost(req, eventId);
  if (caller instanceof NextResponse) return caller;
  try {
    return NextResponse.json(await revokeEventInvite({ eventId, inviteId, userId: caller.userId }));
  } catch (err) {
    return accessResponse(err);
  }
}
