"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: signIn, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // If this account has 2FA enrolled, finish the second step before landing.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2") {
      router.push("/2fa");
      return;
    }
    // Resolve landing: per-user override → per-role default → company fallback.
    const userId = signIn.user?.id;
    let landing = "/";
    const { data: emp } = userId
      ? await supabase
          .from("employees")
          .select("permission_tier, landing_page")
          .eq("auth_user_id", userId)
          .maybeSingle()
      : { data: null };
    if (emp?.landing_page) {
      landing = emp.landing_page;
    } else {
      const role = emp?.permission_tier || "master_admin";
      const { data: rs } = await supabase
        .from("role_settings")
        .select("landing_page")
        .eq("role", role)
        .maybeSingle();
      if (rs?.landing_page) {
        landing = rs.landing_page;
      } else {
        const { data: cs } = await supabase
          .from("company_settings")
          .select("landing_page")
          .eq("id", true)
          .maybeSingle();
        landing = cs?.landing_page || "/";
      }
    }
    router.push(landing);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="card w-full max-w-sm p-8"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Xpress Entertainment" className="mb-2 block w-56 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Xpress Entertainment" className="mb-2 hidden w-56 dark:block" />
        <p className="mb-8 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-600">
          XOS · Xpress Operating System
        </p>
        <label className="label-xs">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mb-4 w-full"
        />
        <label className="label-xs">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mb-5 w-full"
        />
        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Log On"}
        </button>
      </form>
    </div>
  );
}
