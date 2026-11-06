"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { disableEmailMfa, removeSupabaseFactorWithEmailCode, sendEmailMfaCode, verifyEmailMfaCode } from "@/app/(app)/account/mfaActions";
import { createClient } from "@/lib/supabase/client";
import { friendlySupabaseMfaError, maskEmail, maskPhone, sixDigitCode } from "@/lib/mfaMethods";
import { formatPhone, toE164 } from "@/lib/phone";

type Factor = { id: string; phone?: string | null };

/* Authenticator, text message, and email codes. Authenticator and text use
   Supabase MFA. Email is verified here and then accepted by the sign-in gate. */
export default function TwoFactorSetup({
  required = false,
  suggestedPhone = null,
  phoneSource = null,
  email = null,
  emailEnrolled = false,
  emailReady = true,
}: {
  required?: boolean;
  suggestedPhone?: string | null;
  phoneSource?: "login" | "profile" | null;
  email?: string | null;
  emailEnrolled?: boolean;
  emailReady?: boolean;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [totp, setTotp] = useState<Factor | null>(null);
  const [phoneFactor, setPhoneFactor] = useState<Factor | null>(null);
  const [emailOn, setEmailOn] = useState(emailEnrolled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setTotp(data?.totp?.find((factor) => factor.status === "verified") ?? null);
    const phone = data?.phone?.[0];
    setPhoneFactor(phone ? { id: phone.id, phone: readPhone(phone) } : null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!active) return;
      setTotp(data?.totp?.find((factor) => factor.status === "verified") ?? null);
      const phone = data?.phone?.[0];
      setPhoneFactor(phone ? { id: phone.id, phone: readPhone(phone) } : null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  const anyOn = Boolean(totp || phoneFactor || emailOn);

  async function turnOffFactor(factor: Factor, label: string) {
    setError(null);
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") {
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (!unenrollErr) {
        await refresh();
        router.refresh();
        return;
      }
      if (!/aal/i.test(unenrollErr.message)) {
        setError(unenrollErr.message);
        return;
      }
    }
    setRemove({ factorId: factor.id, label });
  }

  const [remove, setRemove] = useState<{ factorId: string; label: string } | null>(null);

  if (loading) return <p className="text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-6">
      {required && !anyOn && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
          Your role requires two-factor authentication. Turn on at least one method below.
        </p>
      )}
      {anyOn ? (
        <p className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          ✓ Two-factor authentication is on
        </p>
      ) : null}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Add a second step at sign-in. Use an authenticator app, a text message, or a code emailed to you.
        You can turn on more than one and pick whichever you have on the sign-in screen.
      </p>

      <Method
        title="Authenticator app"
        body={
          totp
            ? "A code from your authenticator app works at sign-in."
            : "Google Authenticator, 1Password, Authy, or any TOTP app."
        }
      >
        <TotpEditor
          factor={totp}
          onError={setError}
          onChanged={async () => {
            await refresh();
            router.refresh();
          }}
          onTurnOff={(factor) => turnOffFactor(factor, "authenticator app")}
        />
      </Method>

      <Method
        title="Text message"
        body={
          phoneFactor
            ? `Codes go to ${maskPhone(phoneFactor.phone)}.`
            : "A one-time code texted to your mobile. XOS sends it through the same texting line as the rest of the office."
        }
      >
        <PhoneEditor
          factor={phoneFactor}
          suggestedPhone={suggestedPhone}
          phoneSource={phoneSource}
          onError={setError}
          onChanged={async () => {
            await refresh();
            router.refresh();
          }}
          onTurnOff={(factor) => turnOffFactor(factor, "text message")}
        />
      </Method>

      <Method
        title="Email code"
        body={
          emailOn && email
            ? `Codes go to ${email}.`
            : email
              ? `A one-time code emailed to ${email}. It expires in 10 minutes and works once.`
              : "A one-time code emailed to the address on this login."
        }
      >
        {!emailReady ? (
          <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            <p className="mb-1 font-semibold">One-time setup needed</p>
            <p>
              Run migration{" "}
              <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00209_staff_email_mfa.sql</code>{" "}
              in the Supabase SQL editor, then refresh. Authenticator and text codes still work.
            </p>
          </div>
        ) : (
          <EmailEditor
            enrolled={emailOn}
            email={email}
            onError={setError}
            onChanged={async (on) => {
              setEmailOn(on);
              router.refresh();
            }}
          />
        )}
      </Method>

      {remove && (
        <EmailRemoval
          label={remove.label}
          onCancel={() => setRemove(null)}
          onDone={async () => {
            setRemove(null);
            await refresh();
            router.refresh();
          }}
          factorId={remove.factorId}
          onError={setError}
        />
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function Method({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-zinc-200 pt-4 dark:border-white/[0.08]">
      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
      {children}
    </section>
  );
}

function CodeBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="input w-40 tracking-[0.4em]"
      placeholder="000000"
    />
  );
}

function TotpEditor({
  factor,
  onChanged,
  onTurnOff,
  onError,
}: {
  factor: Factor | null;
  onChanged: () => Promise<void>;
  onTurnOff: (factor: Factor) => void;
  onError: (message: string | null) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [enrolling, setEnrolling] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    onError(null);
    setBusy(true);
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const item of list?.all ?? []) {
      if (item.status === "unverified" && item.factor_type === "totp") {
        await supabase.auth.mfa.unenroll({ factorId: item.id });
      }
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
    setBusy(false);
    if (error || !data || data.type !== "totp") {
      onError(error?.message ?? "Could not start authenticator setup.");
      return;
    }
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setFactorId(data.id);
    setEnrolling(true);
  }

  async function verify() {
    if (!factorId || !sixDigitCode(code)) return;
    onError(null);
    setBusy(true);
    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeErr || !challenge) {
      setBusy(false);
      onError(challengeErr?.message ?? "Could not verify the code.");
      return;
    }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
    setBusy(false);
    if (error) {
      onError(error.message);
      return;
    }
    setEnrolling(false);
    setQr(null);
    setSecret(null);
    setCode("");
    await onChanged();
  }

  if (factor && !enrolling) {
    return (
      <button onClick={() => onTurnOff(factor)} className="btn-ghost px-4 py-2 text-xs text-red-600 dark:text-red-400">
        Turn off authenticator
      </button>
    );
  }
  if (!enrolling) {
    return (
      <button onClick={start} disabled={busy} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
        {busy ? "Starting…" : "Set up authenticator app"}
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">1. Scan this with your authenticator app.</p>
      {qr && (
        <div className="inline-block rounded-xl bg-white p-3">
          {qr.trim().startsWith("<svg") ? (
            <div className="size-44" dangerouslySetInnerHTML={{ __html: qr }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Authenticator QR code" className="size-44" />
          )}
        </div>
      )}
      {secret && (
        <p className="text-xs text-zinc-500">
          Can&apos;t scan? Enter this key manually:{" "}
          <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono dark:bg-white/10">{secret}</code>
        </p>
      )}
      <div>
        <label className="label-xs">2. Enter the 6-digit code it shows</label>
        <CodeBox value={code} onChange={setCode} />
      </div>
      <div className="flex gap-2">
        <button onClick={verify} disabled={busy || !sixDigitCode(code)} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
          {busy ? "Verifying…" : "Turn on authenticator"}
        </button>
        <button
          onClick={() => {
            setEnrolling(false);
            setQr(null);
            setSecret(null);
            onError(null);
          }}
          className="btn-ghost px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function PhoneEditor({
  factor,
  suggestedPhone,
  phoneSource,
  onChanged,
  onTurnOff,
  onError,
}: {
  factor: Factor | null;
  suggestedPhone: string | null;
  phoneSource: "login" | "profile" | null;
  onChanged: () => Promise<void>;
  onTurnOff: (factor: Factor) => void;
  onError: (message: string | null) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [number, setNumber] = useState(suggestedPhone ?? "");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    onError(null);
    const phone = toE164(number.trim());
    if (!phone) {
      onError("Enter a mobile number, like 305-555-0199.");
      return;
    }
    setBusy(true);
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const item of list?.all ?? []) {
      if (item.status === "unverified" && item.factor_type === "phone") {
        await supabase.auth.mfa.unenroll({ factorId: item.id });
      }
    }
    const enrolled = await supabase.auth.mfa.enroll({
      factorType: "phone",
      phone,
      friendlyName: "Text message",
    });
    if (enrolled.error || !enrolled.data) {
      setBusy(false);
      onError(friendlySupabaseMfaError(enrolled.error?.message ?? "Could not start text verification."));
      return;
    }
    const challenged = await supabase.auth.mfa.challenge({ factorId: enrolled.data.id, channel: "sms" });
    setBusy(false);
    if (challenged.error || !challenged.data) {
      onError(friendlySupabaseMfaError(challenged.error?.message ?? "Could not text a code."));
      return;
    }
    setFactorId(enrolled.data.id);
    setChallengeId(challenged.data.id);
  }

  async function verify() {
    if (!factorId || !challengeId || !sixDigitCode(code)) return;
    onError(null);
    setBusy(true);
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code: code.trim() });
    setBusy(false);
    if (error) {
      onError(friendlySupabaseMfaError(error.message));
      return;
    }
    setFactorId(null);
    setChallengeId(null);
    setCode("");
    await onChanged();
  }

  if (factor && !challengeId) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-zinc-500">To use a different number, turn this off and set it up again.</p>
        <button onClick={() => onTurnOff(factor)} className="btn-ghost px-4 py-2 text-xs text-red-600 dark:text-red-400">
          Turn off text message
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!challengeId ? (
        <>
          <label className="label-xs">Mobile number</label>
          <input value={number} onChange={(e) => setNumber(e.target.value)} className="input w-full max-w-xs" placeholder="+13055550199" />
          {phoneSource && suggestedPhone && number === suggestedPhone && (
            <p className="text-xs text-zinc-500">
              {phoneSource === "login" ? "This is the mobile number on your login." : "This is the mobile number on your staff profile."}{" "}
              Shown as {formatPhone(suggestedPhone) ?? suggestedPhone}.
            </p>
          )}
          <button onClick={send} disabled={busy || !number.trim()} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
            {busy ? "Sending…" : "Text me a code"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Enter the 6-digit code we texted to {maskPhone(number)}.</p>
          <CodeBox value={code} onChange={setCode} />
          <div className="flex gap-2">
            <button onClick={verify} disabled={busy || !sixDigitCode(code)} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
              {busy ? "Verifying…" : "Turn on text message"}
            </button>
            <button
              onClick={() => {
                setChallengeId(null);
                setFactorId(null);
                onError(null);
              }}
              className="btn-ghost px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EmailEditor({
  enrolled,
  email,
  onChanged,
  onError,
}: {
  enrolled: boolean;
  email: string | null;
  onChanged: (on: boolean) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    onError(null);
    setBusy(true);
    const result = await sendEmailMfaCode("enroll");
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setPhase("code");
  }

  async function verify() {
    if (!sixDigitCode(code)) return;
    onError(null);
    setBusy(true);
    const result = await verifyEmailMfaCode("enroll", code.trim());
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setPhase("idle");
    setCode("");
    await onChanged(true);
  }

  async function turnOff() {
    onError(null);
    setBusy(true);
    const result = await disableEmailMfa();
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    await onChanged(false);
  }

  if (enrolled && phase === "idle") {
    return (
      <button onClick={turnOff} disabled={busy} className="btn-ghost px-4 py-2 text-xs text-red-600 disabled:opacity-50 dark:text-red-400">
        {busy ? "Removing…" : "Turn off email codes"}
      </button>
    );
  }
  if (phase === "idle") {
    return (
      <button onClick={send} disabled={busy || !email} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
        {busy ? "Sending…" : "Email me a code"}
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Enter the 6-digit code we sent to {email ? maskEmail(email) : "your email"}.
      </p>
      <CodeBox value={code} onChange={setCode} />
      <div className="flex gap-2">
        <button onClick={verify} disabled={busy || !sixDigitCode(code)} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
          {busy ? "Verifying…" : "Turn on email codes"}
        </button>
        <button
          onClick={() => {
            setPhase("idle");
            setCode("");
            onError(null);
          }}
          className="btn-ghost px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EmailRemoval({
  factorId,
  label,
  onCancel,
  onDone,
  onError,
}: {
  factorId: string;
  label: string;
  onCancel: () => void;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    onError(null);
    setBusy(true);
    const result = await sendEmailMfaCode("signin");
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setSent(true);
  }

  async function confirm() {
    if (!sixDigitCode(code)) return;
    onError(null);
    setBusy(true);
    const result = await removeSupabaseFactorWithEmailCode(factorId, code.trim());
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    await onDone();
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-white/10">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This sign-in hasn&apos;t used the {label} yet. Enter a fresh email code to turn it off. You&apos;ll be signed out of other devices.
      </p>
      {sent ? <CodeBox value={code} onChange={setCode} /> : null}
      <div className="flex gap-2">
        {!sent ? (
          <button onClick={send} disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {busy ? "Sending…" : "Email me a code"}
          </button>
        ) : (
          <button onClick={confirm} disabled={busy || !sixDigitCode(code)} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {busy ? "Removing…" : "Turn it off"}
          </button>
        )}
        <button onClick={onCancel} className="btn-ghost px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

function readPhone(factor: object): string | null {
  const phone = (factor as { phone?: unknown }).phone;
  return typeof phone === "string" && phone.trim() ? phone.trim() : null;
}
