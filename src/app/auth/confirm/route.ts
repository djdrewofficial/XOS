import { NextResponse } from "next/server";
import { recoveryConfirmPath } from "@/lib/passwordResetPath";

/* Public landing when a recovery link uses /auth/confirm. Forwards only a
   recovery token_hash to /auth/reset on this host. Does not verify or log
   the token. Signup and other types are not turned into a password reset. */

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const dest = new URL(recoveryConfirmPath(url.searchParams), url.origin);
  return NextResponse.redirect(dest);
}
