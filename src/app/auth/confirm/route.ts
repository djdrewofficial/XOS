import { NextResponse } from "next/server";
import { recoveryConfirmPath } from "@/lib/passwordResetPath";

/* Public landing for a Supabase recovery email that uses the documented
   /auth/confirm?token_hash=&type=recovery shape. This route does not verify
   the token and does not log the query. The set-password page does the
   one-time verify. Any next or redirect_to value is ignored. */

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const dest = new URL(recoveryConfirmPath(url.searchParams), url.origin);
  return NextResponse.redirect(dest);
}
