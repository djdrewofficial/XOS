import { NextResponse } from "next/server";
import { isOwnerEmail } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { safeStaffNext, ssoNeedsStaffGate, staffIdentityAllowed } from "@/lib/staffSso";

/* Google and Apple return here after Supabase finishes the browser OAuth code
   exchange. A client or guest login is signed out of this browser only.
   A staff login is not given the passkey step-up cookie, so the existing
   passkey-or-2FA gate still runs. Other devices keep their sessions. */

export const dynamic = "force-dynamic";

function loginRedirect(request: Request, error: string): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError && !url.searchParams.get("code")) {
    return loginRedirect(request, "sso");
  }
  const code = url.searchParams.get("code");
  if (!code) return loginRedirect(request, "sso");

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return loginRedirect(request, "sso");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return loginRedirect(request, "sso");

  const [{ data: acct }, { data: emp }] = await Promise.all([
    supabase.from("accounts").select("account_type").eq("auth_user_id", user.id).maybeSingle(),
    supabase.from("employees").select("id").eq("auth_user_id", user.id).maybeSingle(),
  ]);
  const allowed = staffIdentityAllowed({
    accountType: (acct?.account_type as string | null) ?? null,
    employeeLinked: Boolean(emp?.id),
    ownerEmail: isOwnerEmail(user.email),
  });
  if (!allowed) {
    await supabase.auth.signOut({ scope: "local" });
    return loginRedirect(request, "not-staff");
  }

  const next = safeStaffNext(url.searchParams.get("next"));
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const meta = user.app_metadata ?? {};
  if (
    ssoNeedsStaffGate({
      currentLevel: aal?.currentLevel,
      nextLevel: aal?.nextLevel,
      emailMfa: meta.email_mfa === true,
      passkeyMfa: meta.passkey_mfa === true,
    })
  ) {
    const twoFa = new URL("/2fa", request.url);
    if (next) twoFa.searchParams.set("next", next);
    return NextResponse.redirect(twoFa);
  }

  return NextResponse.redirect(new URL(next ?? "/", request.url));
}
