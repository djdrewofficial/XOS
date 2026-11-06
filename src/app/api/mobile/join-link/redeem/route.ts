import { NextResponse } from "next/server";
import { redeemJoinLink } from "@/lib/eventAccessServer";
import { accessResponse, requestIp, requireMobileUser } from "@/lib/mobileCouple";

/* POST { token } → { ok, eventId, role: "host" | "guest", alreadyMember }
   401 missing or bad session.
   400 token shape is wrong.
   403 staff login.
   404 unknown or expired token.
   429 too many failures in the last hour. Retry-After is seconds.
   503 the join-link tables are not in the database yet.
   Already a host stays a host. Already a guest of this event, opening the
   guest link again, returns alreadyMember. A guest who opens the host link
   becomes a host. */

export async function POST(req: Request) {
  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token.trim()) return NextResponse.json({ error: "That link isn't valid." }, { status: 400 });
  try {
    const result = await redeemJoinLink({
      userId: caller.userId,
      accountType: caller.accountType,
      clientId: caller.clientId,
      email: caller.email,
      phone: caller.phone,
      displayName: caller.displayName,
      rawToken: token,
      ip: requestIp(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    return accessResponse(err);
  }
}
