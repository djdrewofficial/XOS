"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { createClient } from "@/lib/supabase/client";

/** After signing in for another app (/sso/*, e.g. the photo gallery), go back there. */
function ssoNext(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/sso/") ? next : null;
}

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
    const next = ssoNext();
    if (aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2") {
      router.push(next ? `/2fa?next=${encodeURIComponent(next)}` : "/2fa");
      return;
    }
    if (next) {
      // A full page load: /sso/* is a route handler that redirects off-site.
      window.location.assign(next);
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
    <AuthShell subtitle="XOS · Xpress Operating System">
      <form onSubmit={handleSubmit}>
        <label className="label-xs">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mb-4 w-full"
        />
        <label className="label-xs">Password</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mb-5 w-full"
        />
        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
          {loading ? "Signing in…" : "Log On"}
        </button>
        <Link
          href="/auth/forgot-password"
          className="mt-4 block w-full text-center text-xs text-zinc-500 hover:underline"
        >
          Forgot password?
        </Link>
      </form>
    </AuthShell>
  );
}
