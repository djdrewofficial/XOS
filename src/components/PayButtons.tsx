"use client";

import { useState } from "react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";

/* On-page PayPal Smart Buttons (card + Venmo). createOrder/onApprove call our
   /api/paypal endpoints, which validate the amount, add the convenience fee,
   and record the payment server-side. */

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const withFee = (base: number, pct: number) => Math.round(base * (1 + pct / 100) * 100) / 100;

export default function PayButtons({
  token,
  clientId,
  suggested,
  balance,
  feePct,
}: {
  token: string;
  clientId: string;
  suggested: number;
  balance: number;
  feePct: number;
}) {
  const [amount, setAmount] = useState(suggested);
  const [done, setDone] = useState<{ base: number; fee: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const showChoice = balance > suggested + 0.005;
  const charged = withFee(amount, feePct);
  const fee = Math.round((charged - amount) * 100) / 100;

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-6 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <div className="text-2xl">🎉</div>
        <div className="mt-1 text-lg font-bold text-emerald-800 dark:text-emerald-300">Payment received</div>
        <div className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
          {fmt(done.base)} applied to your balance
          {done.fee > 0 ? ` (plus a ${fmt(done.fee)} card fee)` : ""} — a receipt is on its way. Thank you!
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showChoice && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Retainer", value: suggested },
            { label: "Full balance", value: balance },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setAmount(opt.value)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                Math.abs(amount - opt.value) < 0.005
                  ? "border-brand bg-brand/10 text-brand dark:text-brand-lighter"
                  : "border-zinc-300 text-zinc-600 hover:border-brand dark:border-white/15 dark:text-zinc-300"
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{opt.label}</div>
              <div className="text-lg font-bold">{fmt(opt.value)}</div>
            </button>
          ))}
        </div>
      )}

      {feePct > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          A {feePct}% card processing fee applies to online card/PayPal payments. You&apos;ll be charged{" "}
          <strong>{fmt(charged)}</strong> ({fmt(amount)} + {fmt(fee)} fee). Paying by Zelle avoids this fee.
        </div>
      )}

      <div className="text-center text-sm text-zinc-500">
        Charging <span className="font-bold text-zinc-900 dark:text-white">{fmt(charged)}</span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      <PayPalScriptProvider
        options={{ clientId, currency: "USD", enableFunding: "venmo", disableFunding: "credit,paylater", intent: "capture" }}
      >
        <PayPalButtons
          style={{ layout: "vertical", shape: "rect", label: "pay" }}
          disabled={working}
          forceReRender={[amount, feePct]}
          createOrder={async () => {
            setError(null);
            const res = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token, amount }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Could not start the payment.");
            return data.id as string;
          }}
          onApprove={async (data) => {
            setWorking(true);
            try {
              const res = await fetch("/api/paypal/capture-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, orderId: data.orderID }),
              });
              const out = await res.json();
              if (!res.ok) throw new Error(out.error ?? "Payment could not be completed.");
              setDone({ base: out.amount ?? amount, fee: out.fee ?? 0 });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Something went wrong.");
            } finally {
              setWorking(false);
            }
          }}
          onError={() => setError("Something went wrong with PayPal — please try again.")}
        />
      </PayPalScriptProvider>
    </div>
  );
}
