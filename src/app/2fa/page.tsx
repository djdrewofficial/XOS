"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import AuthenticatorCodeField from "@/components/AuthenticatorCodeField";
import MfaMethodSwitch from "@/components/MfaMethodSwitch";
import { emailMfaAvailability, sendEmailMfaCode, verifyEmailMfaCode } from "@/app/(app)/account/mfaActions";
import { stepUpWithPasskey } from "@/lib/passkeyBrowser";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { elevateSessionWithTotp } from "@/lib/mfaStepUp";
import { friendlySupabaseMfaError, maskPhone, pickMfaMethod, sixDigitCode, type MfaMethod } from "@/lib/mfaMethods";

type PhoneFactor = { id: string; phone: string | null };

/* Login second step. Authenticator and text codes raise the Supabase session
   to aal2. An email code satisfies the same app gate for this session. */
export default function TwoFactorChallengePage() {
  const router = useRouter();
  const supabaseRef = useRef<SupabaseClient | null>(null);
  function supabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }
  const [method, setMethod] = useState<MfaMethod | null>(null);
  const [totpId, setTotpId] = useState<string | null>(null);
  const [phone, setPhone] = useState<PhoneFactor | null>(null);
  const [emailOn, setEmailOn] = useState(false);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [passkeyOn, setPasskeyOn] = useState(false);
  const [phoneChallengeId, setPhoneChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;
    Promise.all([
      supabase().auth.mfa.listFactors(),
      supabase().auth.mfa.getAuthenticatorAssuranceLevel(),
      emailMfaAvailability(),
      supabase().auth.getUser(),
    ]).then(
      ([factors, aal, email, user]) => {
        if (!active) return;
        if (aal.data?.currentLevel === "aal2") {
          finish();
          return;
        }
        const totp = factors.data?.totp?.find((factor) => factor.status === "verified") ?? null;
        const phoneFactor = factors.data?.phone?.[0] ?? null;
        const phoneId = phoneFactor?.id ?? null;
        const phoneNumber = phoneFactor ? readPhone(phoneFactor) : null;
        const hasPasskey = user.data.user?.app_metadata?.passkey_mfa === true;
        setTotpId(totp?.id ?? null);
        setPhone(phoneId ? { id: phoneId, phone: phoneNumber } : null);
        setEmailOn(email.enrolled);
        setEmailHint(email.hint);
        setPasskeyOn(hasPasskey);
        const next = pickMfaMethod({ totp: Boolean(totp), phone: Boolean(phoneId), email: email.enrolled });
        if (!next && !hasPasskey) {
          router.replace("/");
          return;
        }
        setMethod(next);
        setReady(true);
        if (next && next !== "totp") {
          void deliver(next, { phoneId, phoneNumber, hint: email.hint });
        }
      },
    );
    return () => {
      active = false;
    };
    // deliver is stable enough for the first load; later sends go through buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (code.length === 6 && method && !busy) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function finish() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/sso/")) {
      window.location.assign(next);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function deliver(
    next: MfaMethod,
    opts?: { phoneId?: string | null; phoneNumber?: string | null; hint?: string | null },
  ) {
    const phoneId = opts?.phoneId ?? phone?.id ?? null;
    const phoneNumber = opts?.phoneNumber ?? phone?.phone ?? null;
    const hint = opts?.hint ?? emailHint;
    setError(null);
    setInfo(null);
    setCode("");
    setBusy(true);
    if (next === "phone" && phoneId) {
      const { data, error: challengeErr } = await supabase().auth.mfa.challenge({ factorId: phoneId, channel: "sms" });
      setBusy(false);
      if (challengeErr || !data) {
        setError(friendlySupabaseMfaError(challengeErr?.message ?? "Couldn't text a code."));
        return;
      }
      setPhoneChallengeId(data.id);
      setSentAt(Date.now());
      setInfo(`We sent a code to ${maskPhone(phoneNumber)}.`);
      return;
    }
    if (next === "email") {
      const result = await sendEmailMfaCode("signin");
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSentAt(Date.now());
      setInfo(`We sent a code to ${hint ?? "your email"}.`);
      return;
    }
    setBusy(false);
  }

  function choose(next: MfaMethod) {
    if (next === method) return;
    setMethod(next);
    setPhoneChallengeId(null);
    setCode("");
    setError(null);
    setInfo(null);
    if (next !== "totp") void deliver(next);
  }

  async function resend() {
    if (!method || method === "totp") return;
    if (sentAt && Date.now() - sentAt < 60_000) {
      setError("Wait a minute before sending another code.");
      return;
    }
    await deliver(method);
  }

  async function verify(e?: FormEvent) {
    e?.preventDefault();
    if (!method || busy || !sixDigitCode(code)) return;
    setError(null);
    setBusy(true);
    if (method === "totp") {
      const mfaError = await elevateSessionWithTotp(supabase(), code);
      setBusy(false);
      if (mfaError) {
        setError(mfaError);
        return;
      }
      finish();
      return;
    }
    if (method === "phone") {
      if (!phone || !phoneChallengeId) {
        setBusy(false);
        setError("Text yourself a code first.");
        return;
      }
      const { error: verifyErr } = await supabase().auth.mfa.verify({
        factorId: phone.id,
        challengeId: phoneChallengeId,
        code: code.trim(),
      });
      setBusy(false);
      if (verifyErr) {
        setError(friendlySupabaseMfaError(verifyErr.message));
        return;
      }
      finish();
      return;
    }
    const result = await verifyEmailMfaCode("signin", code.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    finish();
  }

  async function usePasskey() {
    setError(null);
    setBusy(true);
    const result = await stepUpWithPasskey();
    setBusy(false);
    if (!result.ok) {
      if (!result.cancelled) setError(result.error);
      return;
    }
    finish();
  }

  async function signOut() {
    await supabase().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const methods = [
    totpId ? { id: "totp" as const, label: "Authenticator app", detail: "6-digit code from the app" } : null,
    phone ? { id: "phone" as const, label: "Text message", detail: maskPhone(phone.phone) } : null,
    emailOn ? { id: "email" as const, label: "Email code", detail: emailHint ?? "Code sent to your login email" } : null,
  ].filter((item): item is { id: MfaMethod; label: string; detail: string } => Boolean(item));

  const label =
    method === "phone"
      ? "Enter the 6-digit code from the text message"
      : method === "email"
        ? "Enter the 6-digit code from the email"
        : "Enter the 6-digit code from your authenticator app";

  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-zinc-900 bg-cover bg-center p-4"
      style={{ backgroundImage: "url(/login-bg.jpg)" }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/75" />
      <form onSubmit={verify} className="relative z-10 w-full max-w-sm rounded-2xl border border-white/20 bg-white/95 p-8 shadow-2xl backdrop-blur-md dark:bg-zinc-900/90">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Xpress Entertainment" className="mx-auto mb-2 block w-56 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Xpress Entertainment" className="mx-auto mb-2 hidden w-56 dark:block" />
        <p className="mb-6 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-600">
          Two-Factor Verification
        </p>
        {!ready ? (
          <p className="mb-4 text-center text-sm text-zinc-500">Checking your verification methods…</p>
        ) : !method ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              This password sign-in still needs your passkey. Face ID, Touch ID, a device PIN, or the passkey in
              1Password or iCloud Keychain will finish it.
            </p>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button type="button" onClick={usePasskey} disabled={busy} className="btn-primary w-full disabled:opacity-50">
              {busy ? "Waiting for the passkey…" : "Use a passkey"}
            </button>
          </div>
        ) : (
          <>
            {info && <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">{info}</p>}
            <AuthenticatorCodeField
              autoFocus
              value={code}
              onChange={setCode}
              label={label}
              inputClassName="input w-full text-center text-lg tracking-[0.5em]"
              placeholder="000000"
            />
            {method !== "totp" && (
              <button type="button" onClick={resend} disabled={busy} className="mb-3 w-full text-center text-xs font-semibold text-brand hover:underline disabled:opacity-50 dark:text-brand-lighter">
                {busy ? "Sending…" : "Send another code"}
              </button>
            )}
            {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full disabled:opacity-50">
              {busy ? "Verifying…" : "Verify"}
            </button>
            <MfaMethodSwitch methods={methods} current={method} onPick={choose} />
            {passkeyOn && (
              <button
                type="button"
                onClick={usePasskey}
                disabled={busy}
                className="mt-3 w-full text-center text-xs font-semibold text-brand hover:underline disabled:opacity-50 dark:text-brand-lighter"
              >
                Use a passkey instead
              </button>
            )}
          </>
        )}
        <button type="button" onClick={signOut} className="mt-4 w-full text-center text-xs text-zinc-500 hover:underline">
          Sign in as someone else
        </button>
      </form>
    </div>
  );
}

function readPhone(factor: object): string | null {
  const phone = (factor as { phone?: unknown }).phone;
  return typeof phone === "string" && phone.trim() ? phone.trim() : null;
}
