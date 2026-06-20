import TwoFactorSetup from "@/components/TwoFactorSetup";

export const dynamic = "force-dynamic";

export default function AccountSecurityPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="page-title mb-5">My Security</h1>
      <div className="card p-6">
        <h2 className="card-title mb-1">Two-Factor Authentication</h2>
        <TwoFactorSetup />
      </div>
    </div>
  );
}
