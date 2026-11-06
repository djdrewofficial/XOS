"use client";

import { useCallback, useState } from "react";
import MfaPasswordStep, { type MfaPasswordSelection } from "@/components/MfaPasswordStep";
import PasswordChecklist from "@/components/PasswordChecklist";
import { passwordMeetsPolicy } from "@/lib/passwordPolicy";
import { changeMyPassword, emailMyPasswordReset, sendPasswordChangeCode } from "@/app/(app)/account/actions";

/** Logged-in password change on My Account. Requires the current password so a
    borrowed unlocked screen can't take the account. A secure-password-change
    nonce and an authenticator code are asked for only when Supabase requires them. */
export default function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [nonce, setNonce] = useState("");
  const [code, setCode] = useState("");
  const [selection, setSelection] = useState<MfaPasswordSelection>({
    method: "totp",
    phoneFactorId: null,
    phoneChallengeId: null,
    ready: false,
  });
  const onSelection = useCallback((value: MfaPasswordSelection) => setSelection(value), []);
  const [needsNonce, setNeedsNonce] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);

  const totpOk = !needsMfa || selection.ready;
  const nonceOk = !needsNonce || nonce.trim().length > 0;
  const canSubmit =
    current.length > 0 && passwordMeetsPolicy(pw) && pw === pw2 && pw !== current && totpOk && nonceOk;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setNotice(null);
    if (pw === current) {
      setError("Choose a password that's different from your current one.");
      return;
    }
    if (!passwordMeetsPolicy(pw)) {
      setError("Your password doesn't meet all the requirements below.");
      return;
    }
    if (pw !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    if (needsMfa && !selection.ready) {
      setError("Enter the 6-digit verification code.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await changeMyPassword({
      current,
      next: pw,
      confirm: pw2,
      nonce: nonce.trim() || undefined,
      method: needsMfa ? selection.method : undefined,
      totp: needsMfa && selection.method !== "email" ? code.trim() : undefined,
      phoneFactorId: selection.phoneFactorId ?? undefined,
      phoneChallengeId: selection.phoneChallengeId ?? undefined,
      emailCode: needsMfa && selection.method === "email" ? code.trim() : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      if (result.needsMfa) setNeedsMfa(true);
      if (result.needsNonce) setNeedsNonce(true);
      if (result.needsNonce && !result.needsMfa) {
        setNotice(result.error);
        setError(null);
      } else {
        setError(result.error);
      }
      return;
    }
    setCurrent("");
    setPw("");
    setPw2("");
    setNonce("");
    setCode("");
    setNeedsNonce(false);
    setNeedsMfa(false);
    setSaved(true);
  }

  async function sendLink() {
    setSendingLink(true);
    setLinkError(null);
    setLinkSent(false);
    const result = await emailMyPasswordReset();
    setSendingLink(false);
    if (!result.ok) {
      setLinkError(result.error);
      return;
    }
    setLinkSent(true);
  }

  async function resendCode() {
    setSendingCode(true);
    setError(null);
    const result = await sendPasswordChangeCode();
    setSendingCode(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("We emailed a new confirmation code.");
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm">
      <label className="label-xs">Current password</label>
      <input
        type="password"
        required
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        className="input mb-4 w-full"
      />
      <label className="label-xs">New password</label>
      <input
        type="password"
        required
        autoComplete="new-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        className="input mb-3 w-full"
      />
      <PasswordChecklist password={pw} />
      <label className="label-xs">Confirm new password</label>
      <input
        type="password"
        required
        autoComplete="new-password"
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        className="input mb-2 w-full"
      />
      {pw2.length > 0 && pw !== pw2 && (
        <p className="mb-3 text-xs text-red-600 dark:text-red-400">Passwords don&apos;t match.</p>
      )}
      {pw.length > 0 && pw === current && (
        <p className="mb-3 text-xs text-red-600 dark:text-red-400">
          Choose a password that&apos;s different from your current one.
        </p>
      )}
      <p className="mb-4 mt-2 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
        For your security, passwords found in known data breaches can&apos;t be used.
      </p>
      {needsMfa && <MfaPasswordStep code={code} onCode={setCode} onSelection={onSelection} />}
      {needsNonce && (
        <div className="mb-4">
          <label className="label-xs">Confirmation code</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={nonce}
            onChange={(e) => setNonce(e.target.value.trim())}
            className="input w-full"
            placeholder="Code from your email"
          />
          <button
            type="button"
            onClick={resendCode}
            disabled={sendingCode}
            className="mt-2 text-xs font-semibold text-brand hover:underline disabled:opacity-50 dark:text-brand-lighter"
          >
            {sendingCode ? "Sending…" : "Email me a new code"}
          </button>
        </div>
      )}
      {notice && (
        <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {notice}
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && (
        <p className="mb-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          Password updated. Other signed-in devices have been signed out.
        </p>
      )}
      <button type="submit" disabled={saving || !canSubmit} className="btn-primary disabled:opacity-50">
        {saving ? "Saving…" : "Update password"}
      </button>

      <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-white/[0.08]">
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">Don&apos;t remember your current password?</p>
        <button type="button" onClick={sendLink} disabled={sendingLink} className="btn-ghost disabled:opacity-50">
          {sendingLink ? "Sending…" : "Email me a reset link"}
        </button>
        {linkSent && (
          <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            Check your inbox for a link to choose a new password. If this account uses two-factor authentication, have
            your authenticator, phone, or email ready.
          </p>
        )}
        {linkError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{linkError}</p>}
      </div>
    </form>
  );
}
