"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/* Self-service TOTP two-factor setup for a staff member. Uses Supabase Auth MFA:
   enroll -> show QR/secret -> challenge+verify the first code -> factor active.
   Verifying also elevates the current session to aal2. */
export default function TwoFactorSetup({ required = false }: { required?: boolean }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<"loading" | "enabled" | "idle" | "enrolling">("loading");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setState("enabled");
    } else {
      setState("idle");
    }
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // auto-submit the confirmation code once 6 digits are entered
  useEffect(() => {
    if (state === "enrolling" && code.length === 6 && factorId && !busy) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, state]);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    // drop any stale half-finished factors so enroll doesn't collide
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (error || !data) {
      setError(error?.message ?? "Could not start setup.");
      return;
    }
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setFactorId(data.id);
    setState("enrolling");
  }

  async function verify() {
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
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setQr(null);
    setSecret(null);
    setCode("");
    await refresh();
    router.refresh();
  }

  async function disable() {
    if (!factorId) return;
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    setFactorId(null);
    setState("idle");
    router.refresh();
  }

  if (state === "loading") return <p className="text-sm text-zinc-500">Loading…</p>;

  if (state === "enabled") {
    return (
      <div className="space-y-3">
        <p className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          ✓ Two-factor authentication is on
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You'll be asked for a code from your authenticator app each time you sign in.
        </p>
        <button onClick={disable} disabled={busy} className="btn-ghost px-4 py-2 text-xs text-red-600 dark:text-red-400 disabled:opacity-50">
          {busy ? "Removing…" : "Turn off two-factor"}
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  if (state === "enrolling") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          1. Scan this with an authenticator app (Google Authenticator, 1Password, Authy…).
        </p>
        {qr && (
          <div className="inline-block rounded-xl bg-white p-3">
            {qr.trim().startsWith("<svg") ? (
              <div className="size-44" dangerouslySetInnerHTML={{ __html: qr }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="2FA QR code" className="size-44" />
            )}
          </div>
        )}
        {secret && (
          <p className="text-xs text-zinc-500">
            Can't scan? Enter this key manually: <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono dark:bg-white/10">{secret}</code>
          </p>
        )}
        <div>
          <label className="label-xs">2. Enter the 6-digit code it shows</label>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="input w-40 tracking-[0.4em]"
            placeholder="000000"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button onClick={verify} disabled={busy || code.length !== 6} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
            {busy ? "Verifying…" : "Turn on two-factor"}
          </button>
          <button onClick={() => { setState("idle"); setQr(null); setSecret(null); setError(null); }} className="btn-ghost px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // idle
  return (
    <div className="space-y-3">
      {required && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
          Your role requires two-factor authentication. Set it up below to continue using XOS.
        </p>
      )}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Add a second step to your login: a one-time code from an authenticator app on your phone.
        Strongly recommended for anyone with access to client or financial data.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button onClick={startEnroll} disabled={busy} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
        {busy ? "Starting…" : "Set up two-factor authentication"}
      </button>
    </div>
  );
}
