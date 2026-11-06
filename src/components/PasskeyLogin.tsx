"use client";

import { useEffect, useRef, useState } from "react";
import {
  cancelPasskeyCeremony,
  conditionalPasskeysAvailable,
  passkeysLookSupported,
  signInWithPasskey,
} from "@/lib/passkeyBrowser";

/** Passwordless staff sign-in. A successful passkey opens a Supabase session
    and counts as fully verified, so there is no second code after it. */
export default function PasskeyLogin({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = useRef(onSignedIn);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = passkeysLookSupported();
      if (!cancelled) setSupported(ok);
      if (!ok || !(await conditionalPasskeysAvailable())) return;
      if (cancelled) return;
      const result = await signInWithPasskey(true);
      if (cancelled || (!result.ok && result.cancelled)) return;
      if (!result.ok) {
        if (result.error) setError(result.error);
        return;
      }
      await signedIn.current();
    })();
    return () => {
      cancelled = true;
      cancelPasskeyCeremony();
    };
  }, []);

  if (!supported) return null;

  async function click() {
    setError(null);
    setBusy(true);
    cancelPasskeyCeremony();
    const result = await signInWithPasskey(false);
    if (!result.ok && result.cancelled) {
      setBusy(false);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    await signedIn.current();
  }

  return (
    <div className="mb-5">
      <button type="button" onClick={click} disabled={busy} className="btn-primary w-full disabled:opacity-50">
        {busy ? "Waiting for the passkey…" : "Sign in with a passkey"}
      </button>
      <p className="mt-2 text-center text-xs text-zinc-500">
        Face ID, Touch ID, a device PIN, or a passkey in 1Password or iCloud Keychain.
      </p>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">or</span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
      </div>
    </div>
  );
}
