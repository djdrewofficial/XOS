"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/* Login second step: a staff member with a verified TOTP factor enters a code to
   elevate their session from aal1 -> aal2. Middleware routes them here. */
export default function TwoFactorChallengePage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const init = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === "verified");
    if (!verified) {
      // nothing to challenge — let them through
      router.replace("/");
      return;
    }
    setFactorId(verified.id);
  }, [supabase, router]);

  useEffect(() => {
    init();
  }, [init]);

  // auto-submit as soon as a full 6-digit code is entered
  useEffect(() => {
    if (code.length === 6 && factorId && !busy) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (!factorId || busy) return;
    setError(null);
    setBusy(true);
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr || !ch) {
      setBusy(false);
      setError(chErr?.message ?? "Could not verify the code.");
      return;
    }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-zinc-900 bg-cover bg-center p-4"
      style={{ backgroundImage: "url(/login-bg.jpg)" }}
    >
      {/* darken the photo so the card + inputs stay legible */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/75" />
      <form onSubmit={verify} className="relative z-10 w-full max-w-sm rounded-2xl border border-white/20 bg-white/95 p-8 shadow-2xl backdrop-blur-md dark:bg-zinc-900/90">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Xpress Entertainment" className="mx-auto mb-2 block w-56 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Xpress Entertainment" className="mx-auto mb-2 hidden w-56 dark:block" />
        <p className="mb-6 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-600">
          Two-Factor Verification
        </p>
        <label className="label-xs">Enter the 6-digit code from your authenticator app</label>
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="input mb-4 w-full text-center text-lg tracking-[0.5em]"
          placeholder="000000"
        />
        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full disabled:opacity-50">
          {busy ? "Verifying…" : "Verify"}
        </button>
        <button type="button" onClick={signOut} className="mt-4 w-full text-center text-xs text-zinc-500 hover:underline">
          Sign in as someone else
        </button>
      </form>
    </div>
  );
}
