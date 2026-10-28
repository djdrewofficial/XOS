import TwoFactorSetup from "@/components/TwoFactorSetup";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { createClient } from "@/lib/supabase/server";
import AccountNav from "../AccountNav";

export const dynamic = "force-dynamic";

const REQUIRED = ["master_admin", "admin", "salesperson"];

export default async function AccountSecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let required = false;
  if (user) {
    const { data: emp } = await supabase
      .from("employees")
      .select("permission_tier")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    // no employee row ⇒ owner ⇒ treated as master_admin (matches middleware)
    required = REQUIRED.includes((emp?.permission_tier as string | undefined) ?? "master_admin");
  }

  return (
    <div className="max-w-2xl space-y-5">
      <AccountNav active="security" />
      <div className="card p-6">
        <h2 className="card-title mb-1">Two-Factor Authentication</h2>
        <TwoFactorSetup required={required} />
      </div>
      <div className="card p-6">
        <h2 className="card-title mb-1">Password</h2>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          Choose a new password for your XOS login. You&apos;ll stay signed in here; other devices will be signed out.
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
