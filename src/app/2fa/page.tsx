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

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
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
    <div className="flex min-h-screen items-center justify-center">
      <form onSubmit={verify} className="card w-full max-w-sm p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Xpress Entertainment" className="mb-2 block w-56 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Xpress Entertainment" className="mb-2 hidden w-56 dark:block" />
        <p className="mb-6 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-600">
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
