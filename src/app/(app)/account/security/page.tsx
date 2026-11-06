import PasskeyManager from "@/components/PasskeyManager";
import TwoFactorSetup from "@/components/TwoFactorSetup";
import ChangePasswordSection from "@/components/ChangePasswordSection";
import { preferredMfaPhone } from "@/lib/mfaMethods";
import { listPasskeysForCurrentUser } from "@/lib/passkeyServer";
import { TWO_FA_REQUIRED_ROLES, type Role } from "@/lib/permissions";
import { toE164 } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import AccountNav from "../AccountNav";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let required = false;
  let profilePhone: string | null = null;
  if (user) {
    const { data: emp } = await supabase
      .from("employees")
      .select("permission_tier, phone")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    // no employee row ⇒ owner ⇒ treated as master_admin (matches middleware)
    const tier = (emp?.permission_tier as Role | undefined) ?? "master_admin";
    required = TWO_FA_REQUIRED_ROLES.has(tier);
    profilePhone = (emp?.phone as string | null) ?? null;
  }

  const preferred = preferredMfaPhone(user?.phone, profilePhone, toE164);
  const emailState = await loadEmailFactor(user?.id, user?.app_metadata?.email_mfa === true);
  const passkeys = await listPasskeysForCurrentUser();

  return (
    <div className="max-w-2xl space-y-5">
      <AccountNav active="security" />
      <div className="card p-6">
        <h2 className="card-title mb-1">Passkeys</h2>
        <PasskeyManager ready={passkeys.ready} passkeys={passkeys.passkeys} />
      </div>
      <div className="card p-6">
        <h2 className="card-title mb-1">Two-Factor Authentication</h2>
        <TwoFactorSetup
          required={required}
          suggestedPhone={preferred?.e164 ?? null}
          phoneSource={preferred?.source ?? null}
          email={user?.email ?? null}
          emailEnrolled={emailState.enrolled}
          emailReady={emailState.ready}
          passkeyCount={passkeys.passkeys.length}
        />
      </div>
      <ChangePasswordSection />
    </div>
  );
}

async function loadEmailFactor(userId: string | undefined, flagged: boolean): Promise<{ ready: boolean; enrolled: boolean }> {
  if (!userId) return { ready: true, enrolled: false };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("staff_email_mfa").select("user_id").eq("user_id", userId).maybeSingle();
    if (error) {
      const missing = /does not exist|schema cache|staff_email_mfa/i.test(error.message);
      return { ready: !missing, enrolled: false };
    }
    return { ready: true, enrolled: Boolean(data) || flagged };
  } catch {
    return { ready: false, enrolled: flagged };
  }
}
