import { NextResponse } from "next/server";
import { resetJoinLink } from "@/lib/eventAccessServer";
import { accessResponse, isUuid, requireCoupleHost } from "@/lib/mobileCouple";

/* POST { role: "host" | "guest" } → { role, url, expiresAt }
   Host only. The previous token for that role stops working. */

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const caller = await requireCoupleHost(req, eventId);
  if (caller instanceof NextResponse) return caller;
  const body = await req.json().catch(() => null);
  const role = body?.role === "host" || body?.role === "guest" ? body.role : null;
  if (!role) return NextResponse.json({ error: "Say which link to reset." }, { status: 400 });
  try {
    return NextResponse.json(await resetJoinLink(eventId, role, caller.userId));
  } catch (err) {
    return accessResponse(err);
  }
}
