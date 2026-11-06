import { NextResponse } from "next/server";
import { claimInvitesForUser } from "@/lib/eventAccessServer";
import { accessResponse, requireMobileUser } from "@/lib/mobileCouple";

/* Call after sign-in (email and password, Apple, or Google). Links any open
   invite whose email or phone matches this login. A database trigger does the
   same when a session is created, so a missed call still joins them once
   migration 00212 is applied. Signing up by text is not required. A verified
   phone on the login still claims a phone invite.
   POST {} → { ok, eventIds, reason } */

export async function POST(req: Request) {
  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;
  try {
    return NextResponse.json(
      await claimInvitesForUser({
        userId: caller.userId,
        accountType: caller.accountType,
        clientId: caller.clientId,
        email: caller.email,
        phone: caller.phone,
      }),
    );
  } catch (err) {
    return accessResponse(err);
  }
}
