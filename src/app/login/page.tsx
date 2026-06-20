"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { requestPasswordReset } from "./actions";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    await requestPasswordReset(email);
    setLoading(false);
    setResetMsg("If an account exists for that email, a password reset link is on its way — check your inbox.");
  }

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
    <div
      className="relative flex min-h-screen items-center justify-center bg-zinc-900 bg-cover bg-center p-4"
      style={{ backgroundImage: "url(/login-bg.jpg)" }}
    >
      {/* darken the photo so the card + inputs stay legible */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/75" />
      <form
        onSubmit={mode === "reset" ? handleReset : handleSubmit}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-white/20 bg-white/95 p-8 shadow-2xl backdrop-blur-md dark:bg-zinc-900/90"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Xpress Entertainment" className="mx-auto mb-2 block w-56 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Xpress Entertainment" className="mx-auto mb-2 hidden w-56 dark:block" />
        <p className="mb-8 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-600">
          XOS · Xpress Operating System
        </p>
        <label className="label-xs">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`input w-full ${mode === "reset" ? "mb-5" : "mb-4"}`}
        />

        {mode === "login" ? (
          <>
            <label className="label-xs">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input mb-5 w-full"
            />
            {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
              {loading ? "Signing in…" : "Log On"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("reset"); setError(null); setResetMsg(null); }}
              className="mt-4 w-full text-center text-xs text-zinc-500 hover:underline"
            >
              Forgot your password?
            </button>
          </>
        ) : (
          <>
            {resetMsg ? (
              <p className="mb-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                {resetMsg}
              </p>
            ) : (
              <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
                {loading ? "Sending…" : "Send password reset link"}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setMode("login"); setResetMsg(null); setError(null); }}
              className="mt-4 w-full text-center text-xs text-zinc-500 hover:underline"
            >
              ← Back to sign in
            </button>
          </>
        )}
      </form>
    </div>
  );
}
