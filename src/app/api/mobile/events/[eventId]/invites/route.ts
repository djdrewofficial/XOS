import { NextResponse } from "next/server";
import { parseInviteInput } from "@/lib/eventAccess";
import { createEventInvite } from "@/lib/eventAccessServer";
import { accessResponse, isUuid, requireCoupleHost } from "@/lib/mobileCouple";

/* Invite someone onto this event by phone or email.
   POST { phone?, email?, name?, role?, lang? } → { invite, delivery } */

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const caller = await requireCoupleHost(req, eventId);
  if (caller instanceof NextResponse) return caller;
  const parsed = parseInviteInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const result = await createEventInvite({
      eventId,
      userId: caller.userId,
      callerEmail: caller.email,
      callerPhone: caller.phone,
      parsed,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return accessResponse(err);
  }
}
