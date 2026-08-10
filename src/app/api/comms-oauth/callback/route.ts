import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCodeForToken } from "@/lib/highlevelOAuth";
import { appUrl } from "@/lib/signing";

/* OAuth callback for the HighLevel Marketplace App (native outbound-email
   threading). GHL redirects the admin's browser here after they grant consent.
   Path deliberately avoids the word "highlevel" — GHL's white-label validation
   rejects redirect URLs containing it. The route is NOT in the middleware public
   list, so it only runs for a signed-in staff session; the `state` cookie (set by
   the connectHighLevel action) is the CSRF check. On success the per-location
   OAuth tokens are stored and the admin is returned to Settings → Email. */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const settings = `${appUrl()}/settings/email`;

  const jar = await cookies();
  const expected = jar.get("hl_oauth_state")?.value;
  if (expected) jar.delete("hl_oauth_state");

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(`${settings}?hloauth=error&reason=state`);
  }

  const admin = createAdminClient();
  const result = await exchangeCodeForToken(admin, code);
  if (!result.ok) {
    return NextResponse.redirect(`${settings}?hloauth=error&reason=${encodeURIComponent(result.error.slice(0, 120))}`);
  }
  return NextResponse.redirect(`${settings}?hloauth=connected`);
}
