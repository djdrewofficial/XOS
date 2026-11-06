"use client";

import { useEffect, useState } from "react";
import AuthenticatorCodeField from "@/components/AuthenticatorCodeField";
import MfaMethodSwitch from "@/components/MfaMethodSwitch";
import { emailMfaAvailability, sendEmailMfaCode } from "@/app/(app)/account/mfaActions";
import { createClient } from "@/lib/supabase/client";
import { friendlySupabaseMfaError, maskPhone, pickMfaMethod, sixDigitCode, type MfaMethod } from "@/lib/mfaMethods";

export type MfaPasswordSelection = {
  method: MfaMethod;
  phoneFactorId: string | null;
  phoneChallengeId: string | null;
  ready: boolean;
};

/** Second-factor prompt for a password change. The parent submits the code. */
export default function MfaPasswordStep({
  code,
  onCode,
  onSelection,
}: {
  code: string;
  onCode: (value: string) => void;
  onSelection: (selection: MfaPasswordSelection) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [method, setMethod] = useState<MfaMethod>("totp");
  const [totpOn, setTotpOn] = useState(false);
  const [phone, setPhone] = useState<{ id: string; phone: string | null } | null>(null);
  const [emailOn, setEmailOn] = useState(false);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [phoneChallengeId, setPhoneChallengeId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([supabase.auth.mfa.listFactors(), emailMfaAvailability()]).then(([factors, email]) => {
      if (!active) return;
      const totp = Boolean(factors.data?.totp?.some((factor) => factor.status === "verified"));
      const phoneFactor = factors.data?.phone?.[0] ?? null;
      const nextPhone = phoneFactor ? { id: phoneFactor.id, phone: readPhone(phoneFactor) } : null;
      setTotpOn(totp);
      setPhone(nextPhone);
      setEmailOn(email.enrolled);
      setEmailHint(email.hint);
      const picked = pickMfaMethod({ totp, phone: Boolean(nextPhone), email: email.enrolled }) ?? "totp";
      setMethod(picked);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  const ready = loaded && sixDigitCode(code) && (method !== "phone" || Boolean(phoneChallengeId));

  useEffect(() => {
    onSelection({
      method,
      phoneFactorId: phone?.id ?? null,
      phoneChallengeId,
      ready,
    });
  }, [method, phone, phoneChallengeId, ready, onSelection]);

  async function sendPhone() {
    if (!phone) return;
    setBusy(true);
    setError(null);
    const { data, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: phone.id, channel: "sms" });
    setBusy(false);
    if (challengeErr || !data) {
      setError(friendlySupabaseMfaError(challengeErr?.message ?? "Couldn't text a code."));
      return;
    }
    setPhoneChallengeId(data.id);
    setInfo(`We sent a code to ${maskPhone(phone.phone)}.`);
  }

  async function sendEmail() {
    setBusy(true);
    setError(null);
    const result = await sendEmailMfaCode("signin");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInfo(`We sent a code to ${emailHint ?? "your email"}.`);
  }

  function choose(next: MfaMethod) {
    setMethod(next);
    setError(null);
    setInfo(null);
    onCode("");
    if (next === "phone" && !phoneChallengeId) void sendPhone();
    if (next === "email") void sendEmail();
  }

  const methods: { id: MfaMethod; label: string; detail?: string }[] = [];
  if (totpOn) methods.push({ id: "totp", label: "Authenticator app" });
  if (phone) methods.push({ id: "phone", label: "Text message", detail: maskPhone(phone.phone) });
  if (emailOn) methods.push({ id: "email", label: "Email code", detail: emailHint ?? undefined });

  const label =
    method === "phone"
      ? "Text message code"
      : method === "email"
        ? "Email code"
        : "Authenticator code";

  return (
    <div className="mb-4">
      {info && <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">{info}</p>}
      <AuthenticatorCodeField
        value={code}
        onChange={onCode}
        label={label}
        hint={
          method === "email"
            ? "Email codes sign you in. If an authenticator or text factor is also on, this code is checked and then the password is saved."
            : "We check this code, then save the new password."
        }
      />
      {method === "phone" && !phoneChallengeId && (
        <button type="button" onClick={sendPhone} disabled={busy} className="mb-2 text-xs font-semibold text-brand hover:underline disabled:opacity-50">
          {busy ? "Sending…" : "Text me a code"}
        </button>
      )}
      {method === "email" && !info && (
        <button type="button" onClick={sendEmail} disabled={busy} className="mb-2 text-xs font-semibold text-brand hover:underline disabled:opacity-50">
          {busy ? "Sending…" : "Email me a code"}
        </button>
      )}
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <MfaMethodSwitch methods={methods} current={method} onPick={choose} />
    </div>
  );
}

function readPhone(factor: object): string | null {
  const phone = (factor as { phone?: unknown }).phone;
  return typeof phone === "string" && phone.trim() ? phone.trim() : null;
}
