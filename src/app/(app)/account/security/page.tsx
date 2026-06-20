import TwoFactorSetup from "@/components/TwoFactorSetup";
import { createClient } from "@/lib/supabase/server";

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
    <div className="max-w-2xl">
      <h1 className="page-title mb-5">My Security</h1>
      <div className="card p-6">
        <h2 className="card-title mb-1">Two-Factor Authentication</h2>
        <TwoFactorSetup required={required} />
      </div>
    </div>
  );
}
