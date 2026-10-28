"use client";

import { useState } from "react";
import PasswordChecklist from "@/components/PasswordChecklist";
import { passwordMeetsPolicy } from "@/lib/passwordPolicy";
import { changeMyPassword } from "@/app/(app)/account/actions";

/** Logged-in password change on My Account → Security. Requires the current
    password so a borrowed unlocked screen can't take the account. */
export default function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const canSubmit = current.length > 0 && passwordMeetsPolicy(pw) && pw === pw2 && pw !== current;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
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
    setSaving(true);
    setError(null);
    const result = await changeMyPassword({ current, next: pw, confirm: pw2 });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCurrent("");
    setPw("");
    setPw2("");
    setSaved(true);
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
      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && (
        <p className="mb-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          Password updated. Other signed-in devices have been signed out.
        </p>
      )}
      <button type="submit" disabled={saving || !canSubmit} className="btn-primary disabled:opacity-50">
        {saving ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}
