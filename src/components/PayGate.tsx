"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* Phone-verification gate shown on the public pay page before the balance/pay
   options. Client enters the mobile number on file → we text a 6-digit code →
   they enter it → the check endpoint sets the pay_sess cookie and we refresh so
   the server re-renders the real pay UI. */

export default function PayGate({ token }: { token: string }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [last4, setLast4] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const router = useRouter();

  const send = async () => {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/pay/verify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send a code.");
      setLast4(data.last4 ?? null);
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setWorking(false);
    }
  };

  const verify = async () => {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/pay/verify/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not verify that code.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setWorking(false); // on success we refresh, so only reset on error
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
          <span aria-hidden>🔒</span> Quick security check
        </div>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          {step === "phone"
            ? "To protect your booking, verify it's you. Enter the mobile number on file and we'll text you a code."
            : `Enter the 6-digit code we just texted${last4 ? ` to the number ending in ${last4}` : ""}.`}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {step === "phone" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!working && phone.trim()) send();
          }}
          className="space-y-3"
        >
          <input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-center text-lg tracking-wide text-zinc-900 outline-none focus:border-brand dark:border-white/15 dark:bg-zinc-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={working || !phone.trim()}
            className="w-full rounded-xl bg-gradient-to-r from-brand to-brand-light px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110 disabled:opacity-60"
          >
            {working ? "Sending…" : "Text me a code"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!working && /^\d{6}$/.test(code)) verify();
          }}
          className="space-y-3"
        >
          <input
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] text-zinc-900 outline-none focus:border-brand dark:border-white/15 dark:bg-zinc-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={working || !/^\d{6}$/.test(code)}
            className="w-full rounded-xl bg-gradient-to-r from-brand to-brand-light px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110 disabled:opacity-60"
          >
            {working ? "Verifying…" : "Verify & continue"}
          </button>
          <button
            type="button"
            disabled={working}
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
            className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            ← use a different number / resend
          </button>
        </form>
      )}
    </div>
  );
}
