import { NextResponse } from "next/server";
import { redeemJoinCode } from "@/lib/eventAccessServer";
import { accessResponse, requestIp, requireMobileUser } from "@/lib/mobileCouple";

/* POST { code } → { ok, eventId, role: "partner", alreadyMember } */

export async function POST(req: Request) {
  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;
  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) return NextResponse.json({ error: "Enter the code." }, { status: 400 });
  try {
    const result = await redeemJoinCode({
      userId: caller.userId,
      accountType: caller.accountType,
      clientId: caller.clientId,
      email: caller.email,
      phone: caller.phone,
      displayName: caller.displayName,
      rawCode: code,
      ip: requestIp(req),
    });
    return NextResponse.json({ ...result, role: "partner" });
  } catch (err) {
    return accessResponse(err);
  }
}
