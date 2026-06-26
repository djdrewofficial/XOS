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
export type ZelleInfo = { displayName: string; handle: string | null; memo: string };

export default function MakePayment({
  token, clientId, feePct, balance, installments, zelle,
}: {
  token: string;
  clientId: string | null;
  feePct: number;
  balance: number;
  installments: PayInstallment[];
  zelle: ZelleInfo | null;
}) {
  const cardOk = !!clientId;
  const zelleOk = !!zelle?.handle;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"installments" | "balance">(installments.length ? "installments" : "balance");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<"card" | "zelle" | null>(cardOk && zelleOk ? null : cardOk ? "card" : zelleOk ? "zelle" : null);
  const [done, setDone] = useState<{ base: number; fee: number } | null>(null);
  const [zelleSent, setZelleSent] = useState(false);
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
  const canPay = amount > 0.005;

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const finished = !!done || zelleSent;
  const close = () => {
    if (finished) router.refresh();
    setOpen(false); setDone(null); setZelleSent(false); setError(null); setSelected(new Set());
    setMethod(cardOk && zelleOk ? null : cardOk ? "card" : zelleOk ? "zelle" : null);
  };

  const markZelleSent = async () => {
    setWorking(true); setError(null);
    try {
      const res = await fetch("/api/pay/zelle-pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, amount }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Could not record your Zelle."); }
      setZelleSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setWorking(false);
    }
  };

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
                <Success title="Payment received" body={`${fmt(done.base)} applied to your balance${done.fee > 0 ? ` (plus a ${fmt(done.fee)} card fee)` : ""}. A receipt is on its way. Thank you!`} onClose={close} />
              ) : zelleSent ? (
                <Success
                  emoji="⏳"
                  title="Marked as sent"
                  body={`Thanks! Your ${fmt(amount)} Zelle is pending staff verification — we'll confirm it the moment it lands and update your balance.`}
                  onClose={close}
                />
              ) : (
                <>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Choose what you&apos;d like to pay — one or more scheduled payments, or your full balance.</p>

                  {installments.length > 0 && (
                    <div className="space-y-2">
                      <button onClick={() => setMode("installments")} className={`w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${mode === "installments" ? "border-brand text-brand dark:text-brand-lighter" : "border-zinc-200 text-zinc-400 dark:border-white/10"}`}>Scheduled payments</button>
                      {mode === "installments" && installments.map((i) => {
                        const on = selected.has(i.id);
                        return (
                          <button key={i.id} onClick={() => toggle(i.id)} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${on ? "border-brand bg-brand/5" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"}`}>
                            <span className="flex items-center gap-2.5">
                              <span className={`flex h-5 w-5 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-zinc-300 dark:border-white/20"}`}>{on && <FontAwesomeIcon icon={faCheck} className="text-[10px]" />}</span>
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

                  <button onClick={() => setMode("balance")} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${mode === "balance" ? "border-brand bg-brand/5" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"}`}>
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Pay full balance</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-50">{fmt(balance)}</span>
                  </button>

                  <div className="rounded-xl bg-zinc-50 px-4 py-3 text-center dark:bg-white/5">
                    <div className="text-xs uppercase tracking-wide text-zinc-400">Paying</div>
                    <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{fmt(amount)}</div>
                  </div>

                  {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

                  {!canPay ? (
                    <p className="text-center text-sm text-zinc-400">Select a payment to continue.</p>
                  ) : !cardOk && !zelleOk ? (
                    <p className="text-center text-sm text-zinc-400">Online payments aren&apos;t available right now.</p>
                  ) : (
                    <>
                      {cardOk && zelleOk && (
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => setMethod("card")} className={`rounded-xl border px-3 py-2.5 text-center text-sm font-semibold transition ${method === "card" ? "border-brand bg-brand/10 text-brand dark:text-brand-lighter" : "border-zinc-200 text-zinc-600 hover:border-brand/50 dark:border-white/10 dark:text-zinc-300"}`}>Card / PayPal</button>
                          <button onClick={() => setMethod("zelle")} className={`rounded-xl border px-3 py-2.5 text-center text-sm font-semibold transition ${method === "zelle" ? "border-brand bg-brand/10 text-brand dark:text-brand-lighter" : "border-zinc-200 text-zinc-600 hover:border-brand/50 dark:border-white/10 dark:text-zinc-300"}`}>Zelle (no fee)</button>
                        </div>
                      )}

                      {method === "card" && cardOk && (
                        <div className="space-y-3">
                          {feePct > 0 && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">A {feePct}% card fee applies — you&apos;ll be charged {fmt(charged)} ({fmt(amount)} + {fmt(fee)} fee). Zelle avoids this fee.</div>}
                          <PayPalScriptProvider options={{ clientId: clientId!, currency: "USD", enableFunding: "venmo", disableFunding: "credit,paylater", intent: "capture" }}>
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
                                } finally { setWorking(false); }
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
                            <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-zinc-500 dark:text-zinc-400">
                              <li>Open your bank&apos;s app and choose Zelle.</li>
                              <li>Send {fmt(amount)} to the recipient above.</li>
                              <li>Add the memo, then tap the button below.</li>
                            </ol>
                          </div>
                          <button onClick={markZelleSent} disabled={working} className="btn-primary w-full disabled:opacity-50">{working ? "One sec…" : "I've sent my Zelle"}</button>
                          <p className="text-center text-xs text-zinc-400">We&apos;ll mark it pending and confirm once it lands.</p>
                        </div>
                      )}
                    </>
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
