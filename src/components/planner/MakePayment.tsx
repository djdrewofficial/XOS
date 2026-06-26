"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faCheck } from "@fortawesome/free-solid-svg-icons";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const withFee = (base: number, pct: number) => Math.round(base * (1 + pct / 100) * 100) / 100;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null);

export type PayInstallment = { id: string; label: string | null; dueDate: string | null; amount: number };

export default function MakePayment({
  token, clientId, feePct, balance, installments,
}: {
  token: string;
  clientId: string | null;
  feePct: number;
  balance: number;
  installments: PayInstallment[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"installments" | "balance">(installments.length ? "installments" : "balance");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<{ base: number; fee: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const router = useRouter();

  const amount = useMemo(() => {
    if (mode === "balance") return balance;
    const sum = installments.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.amount, 0);
    return Math.min(sum, balance);
  }, [mode, selected, installments, balance]);

  const charged = withFee(amount, feePct);
  const fee = Math.round((charged - amount) * 100) / 100;
  const canPay = amount > 0.005 && !!clientId;

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const close = () => { if (done) router.refresh(); setOpen(false); setDone(null); setError(null); setSelected(new Set()); };

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary w-full">Make a payment</button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={close}>
          <div className="my-8 flex max-h-[calc(100vh-4rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-white/10">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">Make a payment</h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"><FontAwesomeIcon icon={faXmark} /></button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {done ? (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-6 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <div className="text-2xl">🎉</div>
                  <div className="mt-1 text-lg font-bold text-emerald-800 dark:text-emerald-300">Payment received</div>
                  <div className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
                    {fmt(done.base)} applied to your balance{done.fee > 0 ? ` (plus a ${fmt(done.fee)} card fee)` : ""}. A receipt is on its way. Thank you!
                  </div>
                  <button onClick={close} className="btn-primary mt-4">Done</button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Choose what you&apos;d like to pay. Select one or more scheduled payments, or pay your full balance.</p>

                  {installments.length > 0 && (
                    <div className="space-y-2">
                      <button
                        onClick={() => setMode("installments")}
                        className={`w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${mode === "installments" ? "border-brand text-brand dark:text-brand-lighter" : "border-zinc-200 text-zinc-400 dark:border-white/10"}`}
                      >
                        Scheduled payments
                      </button>
                      {mode === "installments" && installments.map((i) => {
                        const on = selected.has(i.id);
                        return (
                          <button key={i.id} onClick={() => toggle(i.id)} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${on ? "border-brand bg-brand/5" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"}`}>
                            <span className="flex items-center gap-2.5">
                              <span className={`flex h-5 w-5 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-zinc-300 dark:border-white/20"}`}>
                                {on && <FontAwesomeIcon icon={faCheck} className="text-[10px]" />}
                              </span>
                              <span>
                                <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">{i.label || "Payment"}</span>
                                {fmtDate(i.dueDate) && <span className="text-xs text-zinc-400">Due {fmtDate(i.dueDate)}</span>}
                              </span>
                            </span>
                            <span className="shrink-0 font-bold text-zinc-900 dark:text-zinc-50">{fmt(i.amount)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button
                    onClick={() => setMode("balance")}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${mode === "balance" ? "border-brand bg-brand/5" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"}`}
                  >
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Pay full balance</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-50">{fmt(balance)}</span>
                  </button>

                  <div className="rounded-xl bg-zinc-50 px-4 py-3 text-center dark:bg-white/5">
                    <div className="text-xs uppercase tracking-wide text-zinc-400">Paying</div>
                    <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{fmt(amount)}</div>
                    {feePct > 0 && amount > 0 && <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">+ {fmt(fee)} card fee · charged {fmt(charged)}. Zelle avoids this fee.</div>}
                  </div>

                  {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

                  {!clientId ? (
                    <p className="text-center text-sm text-zinc-400">Online payments aren&apos;t available right now.</p>
                  ) : !canPay ? (
                    <p className="text-center text-sm text-zinc-400">Select a payment to continue.</p>
                  ) : (
                    <PayPalScriptProvider options={{ clientId, currency: "USD", enableFunding: "venmo", disableFunding: "credit,paylater", intent: "capture" }}>
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
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
