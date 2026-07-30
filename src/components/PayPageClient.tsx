"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import type { PayInstallment } from "@/lib/payInfo";

/* Dedicated payment page body. Shows the event's payment schedule as checkboxes
   (next unpaid checked by default), or "pay full balance", then card (PayPal) /
   Zelle. Reuses the /api/paypal and /api/pay endpoints. Not the welcome/booking
   page — this is purpose-built for making a payment. */

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const withFee = (base: number, pct: number) => Math.round(base * (1 + pct / 100) * 100) / 100;
const fmtDate = (d: string | null) =>
  d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

export type PayZelle = { displayName: string; handle: string | null; memo: string };

export default function PayPageClient({
  token,
  paypalClientId,
  feePct,
  balance,
  installments,
  zelle,
  paypalEnabled,
  zelleEnabled,
}: {
  token: string;
  paypalClientId: string | null;
  feePct: number;
  balance: number;
  installments: PayInstallment[];
  zelle: PayZelle | null;
  paypalEnabled: boolean;
  zelleEnabled: boolean;
}) {
  const cardOk = paypalEnabled && !!paypalClientId;
  const zelleOk = zelleEnabled && !!zelle?.handle;

  const unpaid = useMemo(() => installments.filter((i) => !i.paid), [installments]);
  const paid = useMemo(() => installments.filter((i) => i.paid), [installments]);
  const firstUnpaidId = unpaid[0]?.id ?? null;

  const [mode, setMode] = useState<"installments" | "balance">(unpaid.length ? "installments" : "balance");
  // default: next unpaid installment checked
  const [selected, setSelected] = useState<Set<string>>(() => new Set(firstUnpaidId ? [firstUnpaidId] : []));
  const [method, setMethod] = useState<"card" | "zelle" | null>(cardOk && zelleOk ? null : cardOk ? "card" : zelleOk ? "zelle" : null);
  const [done, setDone] = useState<{ base: number; fee: number } | null>(null);
  const [zelleSent, setZelleSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const router = useRouter();

  const amount = useMemo(() => {
    if (mode === "balance") return balance;
    const sum = unpaid.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.amount, 0);
    return Math.min(sum, balance);
  }, [mode, selected, unpaid, balance]);

  const charged = withFee(amount, feePct);
  const fee = Math.round((charged - amount) * 100) / 100;
  const canPay = amount > 0.005;

  const toggle = (id: string) => {
    setMode("installments");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const markZelleSent = async () => {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/pay/zelle-pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, amount }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not record your Zelle.");
      }
      setZelleSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setWorking(false);
    }
  };

  if (done) {
    return (
      <Success
        title="Payment received"
        body={`${fmt(done.base)} applied to your balance${done.fee > 0 ? ` (plus a ${fmt(done.fee)} card fee)` : ""}. A receipt is on its way. Thank you!`}
        onClose={() => router.refresh()}
      />
    );
  }
  if (zelleSent) {
    return (
      <Success
        emoji="⏳"
        title="Marked as sent"
        body={`Thanks! Your ${fmt(amount)} Zelle is pending our confirmation — we'll update your balance the moment it lands.`}
        onClose={() => router.refresh()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Choose what to pay</div>

        {unpaid.length > 0 && (
          <div className="space-y-2">
            {unpaid.map((i) => {
              const on = mode === "installments" && selected.has(i.id);
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => toggle(i.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${on ? "border-brand bg-brand/5" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"}`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-zinc-300 dark:border-white/20"}`}>
                      {on && <span className="text-[11px] leading-none">✓</span>}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">{i.label || `Payment ${i.seq || ""}`.trim()}</span>
                      {fmtDate(i.dueDate) && <span className="text-xs text-zinc-400">Due {fmtDate(i.dueDate)}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold text-zinc-900 dark:text-zinc-50">{fmt(i.amount)}</span>
                </button>
              );
            })}
          </div>
        )}

        {paid.length > 0 && (
          <div className="mt-2 space-y-1">
            {paid.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-200 px-3 py-2 text-left opacity-60 dark:border-white/10">
                <span className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] leading-none text-white">✓</span>
                  <span>
                    <span className="block text-sm font-medium text-zinc-700 line-through dark:text-zinc-300">{i.label || `Payment ${i.seq || ""}`.trim()}</span>
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">Paid</span>
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-zinc-500">{fmt(i.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {balance > 0.005 && (
          <button
            type="button"
            onClick={() => setMode("balance")}
            className={`mt-2 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${mode === "balance" ? "border-brand bg-brand/5" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"}`}
          >
            <span className="flex items-center gap-2.5">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${mode === "balance" ? "border-brand bg-brand text-white" : "border-zinc-300 dark:border-white/20"}`}>
                {mode === "balance" && <span className="text-[11px] leading-none">✓</span>}
              </span>
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Pay full balance</span>
            </span>
            <span className="font-bold text-zinc-900 dark:text-zinc-50">{fmt(balance)}</span>
          </button>
        )}
      </div>

      <div className="rounded-xl bg-zinc-50 px-4 py-3 text-center dark:bg-white/5">
        <div className="text-xs uppercase tracking-wide text-zinc-400">Paying now</div>
        <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{fmt(amount)}</div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

      {!canPay ? (
        <p className="text-center text-sm text-zinc-400">Select a payment above to continue.</p>
      ) : !cardOk && !zelleOk ? (
        <p className="text-center text-sm text-zinc-400">Online payments aren&apos;t available right now — please reach out to us.</p>
      ) : (
        <>
          {cardOk && zelleOk && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMethod("card")} className={`rounded-xl border px-3 py-2.5 text-center text-sm font-semibold transition ${method === "card" ? "border-brand bg-brand/10 text-brand dark:text-brand-lighter" : "border-zinc-200 text-zinc-600 hover:border-brand/50 dark:border-white/10 dark:text-zinc-300"}`}>Card / PayPal / Venmo</button>
              <button type="button" onClick={() => setMethod("zelle")} className={`rounded-xl border px-3 py-2.5 text-center text-sm font-semibold transition ${method === "zelle" ? "border-brand bg-brand/10 text-brand dark:text-brand-lighter" : "border-zinc-200 text-zinc-600 hover:border-brand/50 dark:border-white/10 dark:text-zinc-300"}`}>Zelle (no fee)</button>
            </div>
          )}

          {method === "card" && cardOk && (
            <div className="space-y-3">
              {feePct > 0 && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  A {feePct}% card fee applies — you&apos;ll be charged {fmt(charged)} ({fmt(amount)} + {fmt(fee)} fee). Zelle avoids this fee.
                </div>
              )}
              <PayPalScriptProvider options={{ clientId: paypalClientId!, currency: "USD", enableFunding: "venmo", disableFunding: "credit,paylater", intent: "capture" }}>
                <PayPalButtons
                  style={{ layout: "vertical", shape: "rect", label: "pay" }}
                  disabled={working}
                  forceReRender={[amount, feePct]}
                  createOrder={async () => {
                    setError(null);
                    const res = await fetch("/api/paypal/create-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, amount }) });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error ?? "Could not start the payment.");
                    return data.id as string;
                  }}
                  onApprove={async (data) => {
                    setWorking(true);
                    try {
                      const res = await fetch("/api/paypal/capture-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, orderId: data.orderID }) });
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
          )}

          {method === "zelle" && zelleOk && zelle && (
            <div className="space-y-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                <div className="mb-2 font-semibold text-zinc-900 dark:text-white">Send your Zelle ({fmt(amount)}) to:</div>
                <div className="flex items-center justify-between py-0.5"><span className="text-zinc-500">Recipient</span><span className="font-semibold text-zinc-800 dark:text-zinc-100">{zelle.displayName}</span></div>
                <div className="flex items-center justify-between py-0.5"><span className="text-zinc-500">Zelle</span><span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">{zelle.handle}</span></div>
                <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{zelle.memo}</div>
              </div>
              <button onClick={markZelleSent} disabled={working} className="w-full rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110 disabled:opacity-60">
                {working ? "One sec…" : "I've sent my Zelle"}
              </button>
              <p className="text-center text-xs text-zinc-400">We&apos;ll mark it pending and confirm once it lands.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Success({ emoji = "🎉", title, body, onClose }: { emoji?: string; title: string; body: string; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-6 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
      <div className="text-2xl">{emoji}</div>
      <div className="mt-1 text-lg font-bold text-emerald-800 dark:text-emerald-300">{title}</div>
      <div className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">{body}</div>
      <button onClick={onClose} className="btn-primary mt-4">Done</button>
    </div>
  );
}
