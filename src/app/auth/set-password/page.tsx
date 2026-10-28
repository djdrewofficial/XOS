"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import PasswordChecklist from "@/components/PasswordChecklist";
import { createClient } from "@/lib/supabase/client";
import { passwordMeetsPolicy } from "@/lib/passwordPolicy";

/* Lands the person from a password email and lets them choose a new one.

   Three link shapes, all public (middleware exempts /auth/*):
   - Supabase reset email, token-hash template: ?token_hash=&type=recovery
     → verifyOtp. Works on any device. This is the flow to configure.
   - Supabase reset email, default template: ?code= (PKCE). The code verifier
     cookie was stored when this browser requested the email, so
     exchangeCodeForSession only succeeds in that same browser.
   - Staff invite / admin reset (Mailgun generateLink): #access_token= or ?code=
     → setSession / exchangeCodeForSession. Left in place so those emails
     keep working. */

const RECOVERY_KEY = "xos-pwreset";

function cleanUrl() {
  window.history.replaceState(null, "", "/auth/set-password");
}

function markRecovery() {
  try {
    sessionStorage.setItem(RECOVERY_KEY, "1");
  } catch {
    /* private mode — the in-memory session still lets them finish this visit */
  }
}

function clearRecovery() {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* ignore */
  }
}

function hasRecovery() {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === "1";
  } catch {
    return false;
  }
}

function hashParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

export default function SetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ready" | "invalid">("loading");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const failed = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") markRecovery();
      // Backup for a session that arrives after init. A normal signed-in
      // visit (no recovery grant) must not open the form, and a link we
      // already rejected must stay rejected.
      if (active && settled.current && !failed.current && session && hasRecovery()) setStatus("ready");
    });

    async function init() {
      try {
        const url = new URL(window.location.href);
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");
        const code = url.searchParams.get("code");
        const hash = hashParams();
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");

        if (tokenHash) {
          // This page only finishes password recovery. Don't accept other
          // OTP types (signup, magic link, email change) through it.
          if (type && type !== "recovery") {
            failed.current = true;
            clearRecovery();
            if (active) setStatus("invalid");
            return;
          }
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });
          if (error || !data.session) {
            failed.current = true;
            clearRecovery();
            if (active) setStatus("invalid");
            return;
          }
          markRecovery();
          cleanUrl();
          if (active) setStatus("ready");
          return;
        }

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error || !data.session) {
            failed.current = true;
            clearRecovery();
            if (active) setStatus("invalid");
            return;
          }
          markRecovery();
          cleanUrl();
          if (active) setStatus("ready");
          return;
        }

        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error || !data.session) {
            failed.current = true;
            clearRecovery();
            if (active) setStatus("invalid");
            return;
          }
          markRecovery();
          cleanUrl();
          if (active) setStatus("ready");
          return;
        }

        const linkError =
          url.searchParams.get("error") ||
          url.searchParams.get("error_code") ||
          hash.get("error") ||
          hash.get("error_code");
        if (linkError) {
          failed.current = true;
          clearRecovery();
          if (active) setStatus("invalid");
          return;
        }

        // No token on this load. A refresh during an in-progress reset still
        // has the recovery grant; a normal signed-in visit does not.
        const { data } = await supabase.auth.getSession();
        if (active) setStatus(data.session && hasRecovery() ? "ready" : "invalid");
      } catch {
        failed.current = true;
        clearRecovery();
        if (active) setStatus("invalid");
      } finally {
        settled.current = true;
      }
    }

    init();

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    // Drop every other device. The recovery session we just used stays.
    await supabase.auth.signOut({ scope: "others" });
    clearRecovery();
    setDone(true);
    // middleware routes staff to the app and external users to /portal
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 900);
  }

  const canSubmit = passwordMeetsPolicy(pw) && pw === pw2;

  return (
    <AuthShell subtitle="XOS · Set Your Password">
      {status === "loading" && <p className="text-sm text-zinc-500">Verifying your link…</p>}

      {status === "invalid" && (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-4">This link is invalid or has expired. Request a new reset email and try again.</p>
          <Link href="/auth/forgot-password" className="btn-primary mb-3 w-full">
            Request a new email
          </Link>
          <Link href="/login" className="block w-full text-center text-xs text-zinc-500 hover:underline">
            Back to sign in
          </Link>
        </div>
      )}

      {status === "ready" && !done && (
        <form onSubmit={handleSubmit}>
          <label className="label-xs">New password</label>
          <input
            type="password"
            required
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="input mb-3 w-full"
            autoComplete="new-password"
          />
          <PasswordChecklist password={pw} />
          <label className="label-xs">Confirm password</label>
          <input
            type="password"
            required
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            className="input mb-2 w-full"
            autoComplete="new-password"
          />
          {pw2.length > 0 && pw !== pw2 && (
            <p className="mb-3 text-xs text-red-600 dark:text-red-400">Passwords don&apos;t match.</p>
          )}
          <p className="mb-4 mt-2 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
            For your security, passwords found in known data breaches can&apos;t be used.
          </p>
          {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={saving || !canSubmit} className="btn-primary w-full disabled:opacity-50">
            {saving ? "Saving…" : "Set Password & Sign In"}
          </button>
        </form>
      )}

      {done && (
        <p className="text-sm font-semibold text-green-600 dark:text-green-400">
          Password updated. Signing you in…
        </p>
      )}
    </AuthShell>
  );
}
