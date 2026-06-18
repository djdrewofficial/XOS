"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ready" | "invalid">("loading");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    // Establish the session from the recovery/invite link (hash or PKCE code).
    async function init() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code) {
        try {
          await supabase.auth.exchangeCodeForSession(code);
        } catch {
          /* fall through to session check */
        }
      } else if (window.location.hash.includes("access_token")) {
        // Implicit recovery link: tokens arrive in the URL hash. The PKCE client
        // won't auto-consume them, so establish the session explicitly.
        const hp = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const access_token = hp.get("access_token");
        const refresh_token = hp.get("refresh_token");
        if (access_token && refresh_token) {
          try {
            await supabase.auth.setSession({ access_token, refresh_token });
          } catch {
            /* fall through to session check */
          }
        }
      }
      const { data } = await supabase.auth.getSession();
      if (active && data.session) setStatus("ready");
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) setStatus("ready");
    });

    init();
    // If no session materialises, the link is bad/expired.
    const timer = setTimeout(() => {
      if (active) setStatus((s) => (s === "loading" ? "invalid" : s));
    }, 4000);

    return () => {
      active = false;
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) {
      setError("Use at least 8 characters.");
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
    setDone(true);
    // middleware routes staff to the app and external users to /portal
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 900);
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="card w-full max-w-sm p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Xpress Entertainment" className="mb-2 block w-56 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Xpress Entertainment" className="mb-2 hidden w-56 dark:block" />
        <p className="mb-8 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-600">
          XOS · Set Your Password
        </p>

        {status === "loading" && (
          <p className="text-sm text-zinc-500">Verifying your link…</p>
        )}

        {status === "invalid" && (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            <p className="mb-3">This link is invalid or has expired.</p>
            <a href="/login" className="font-semibold text-brand underline dark:text-brand-lighter">
              Go to sign in
            </a>
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
              className="input mb-4 w-full"
              autoComplete="new-password"
            />
            <label className="label-xs">Confirm password</label>
            <input
              type="password"
              required
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              className="input mb-5 w-full"
              autoComplete="new-password"
            />
            {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button type="submit" disabled={saving} className="btn-primary w-full disabled:opacity-50">
              {saving ? "Saving…" : "Set Password & Sign In"}
            </button>
          </form>
        )}

        {done && (
          <p className="text-sm font-semibold text-green-600 dark:text-green-400">
            Password set! Taking you in…
          </p>
        )}
      </div>
    </div>
  );
}
