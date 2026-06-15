"use client";

import { useState } from "react";
import PayButtons from "@/components/PayButtons";

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export type WelcomePaymentProps = {
  token: string;
  paypalClientId: string | null;
  suggested: number;
  balance: number;
  feePct: number;
  paypalEnabled: boolean;
  zelleEnabled: boolean;
  zelleDisplayName: string;
  zelleHandle: string | null;
  zelleMemo: string;
  autopayEligible: boolean; // installment plan → autopay can be offered
  autopayArmed: boolean; // a card is already saved
};

const cardBtn =
  "rounded-xl border border-zinc-300 px-4 py-4 text-left transition-colors hover:border-brand hover:bg-brand/5 dark:border-white/15";

export default function WelcomePayment(props: WelcomePaymentProps) {
  const paypalOk = props.paypalEnabled && !!props.paypalClientId;
  const zelleOk = props.zelleEnabled && !!props.zelleHandle;
  const canAutopay = props.autopayEligible && !props.autopayArmed && paypalOk;

  // top-level path: autopay vs one-time (only a real choice when canAutopay)
  const [path, setPath] = useState<"autopay" | "onetime" | null>(canAutopay ? null : "onetime");
  // one-time method (when both methods exist)
  const both = paypalOk && zelleOk;
  const [method, setMethod] = useState<"paypal" | "zelle" | null>(both ? null : paypalOk ? "paypal" : zelleOk ? "zelle" : null);
  // autopay consent gate
  const [consented, setConsented] = useState(false);
  const [arming, setArming] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!paypalOk && !zelleOk) {
    return (
      <p className="text-center text-sm text-zinc-500">
        Please reach out to us to arrange your payment — online options aren&apos;t available right now.
      </p>
    );
  }

  async function startAutopay() {
    setError(null);
    setArming(true);
    try {
      const res = await fetch("/api/pay/autopay-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: props.token }),
      });
      if (!res.ok) throw new Error("Could not set up autopay — please try again.");
      setArmed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setArming(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* top-level choice */}
      {canAutopay && path === null && (
        <div className="grid gap-3">
          <button type="button" onClick={() => setPath("autopay")} className={cardBtn}>
            <div className="text-base font-bold text-zinc-900 dark:text-white">Set up automatic payments</div>
            <div className="mt-0.5 text-xs text-zinc-500">Pay your retainer now and save your card — each scheduled payment is charged automatically on its due date.</div>
          </button>
          <button type="button" onClick={() => setPath("onetime")} className={cardBtn}>
            <div className="text-base font-bold text-zinc-900 dark:text-white">Make a one-time payment</div>
            <div className="mt-0.5 text-xs text-zinc-500">Pay now by card or Zelle — you&apos;ll handle each future payment yourself.</div>
          </button>
        </div>
      )}

      {/* ---- AUTOPAY ---- */}
      {path === "autopay" && (
        <div className="space-y-3">
          {!armed ? (
            <>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 dark:border-white/15 dark:bg-white/[0.03]">
                <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} className="mt-0.5 size-4 accent-brand-light" />
                <span className="text-xs text-zinc-600 dark:text-zinc-300">
                  I authorize Xpress Entertainment to save my payment method and automatically charge it for each
                  scheduled payment on its due date. I can cancel anytime by contacting the office.
                </span>
              </label>
              {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
              <button
                type="button"
                disabled={!consented || arming}
                onClick={startAutopay}
                className="w-full rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110 disabled:opacity-50"
              >
                {arming ? "One sec…" : `Continue — pay ${fmt(props.suggested)} retainer`}
              </button>
              <button type="button" onClick={() => setPath(canAutopay ? null : "onetime")} className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600">
                ← back
              </button>
            </>
          ) : (
            <PayButtons token={props.token} clientId={props.paypalClientId!} suggested={props.suggested} balance={props.balance} feePct={props.feePct} autopay />
          )}
        </div>
      )}

      {/* ---- ONE-TIME ---- */}
      {path === "onetime" && (
        <div className="space-y-4">
          {both && method === null && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setMethod("zelle")} className={cardBtn}>
                <div className="text-base font-bold text-zinc-900 dark:text-white">Zelle</div>
                <div className="mt-0.5 text-xs text-zinc-500">No fees · pay from your bank app</div>
              </button>
              <button type="button" onClick={() => setMethod("paypal")} className={cardBtn}>
                <div className="text-base font-bold text-zinc-900 dark:text-white">Card / PayPal / Venmo</div>
                <div className="mt-0.5 text-xs text-zinc-500">Instant · {props.feePct}% card fee applies</div>
              </button>
            </div>
          )}

          {method === "paypal" && paypalOk && (
            <div className="space-y-3">
              <PayButtons token={props.token} clientId={props.paypalClientId!} suggested={props.suggested} balance={props.balance} feePct={props.feePct} />
              {both && <button type="button" onClick={() => setMethod(null)} className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600">← choose another method</button>}
            </div>
          )}

          {method === "zelle" && zelleOk && <ZellePanel {...props} onBack={both ? () => setMethod(null) : undefined} />}

          {canAutopay && (
            <button type="button" onClick={() => setPath(null)} className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600">← back to payment options</button>
          )}
        </div>
      )}
    </div>
  );
}

function ZellePanel({
  token,
  suggested,
  balance,
  zelleDisplayName,
  zelleHandle,
  zelleMemo,
  onBack,
}: WelcomePaymentProps & { onBack?: () => void }) {
  const [claimed, setClaimed] = useState(false);
  const [working, setWorking] = useState(false);

  if (claimed) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-6 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <div className="text-2xl">🙌</div>
        <div className="mt-1 text-lg font-bold text-emerald-800 dark:text-emerald-300">Thank you!</div>
        <div className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
          We&apos;ll confirm your Zelle payment as soon as it lands and update your balance.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm dark:border-white/10 dark:bg-white/[0.03]">
        <div className="mb-2 font-semibold text-zinc-900 dark:text-white">Send your Zelle to:</div>
        <div className="flex items-center justify-between"><span className="text-zinc-500">Recipient</span><span className="font-semibold">{zelleDisplayName}</span></div>
        <div className="flex items-center justify-between"><span className="text-zinc-500">Zelle</span><span className="font-mono font-semibold">{zelleHandle}</span></div>
        <div className="mt-1 flex items-center justify-between"><span className="text-zinc-500">Suggested amount</span><span className="font-bold">{fmt(suggested)}</span></div>
        {balance > suggested + 0.005 && <div className="mt-0.5 text-right text-xs text-zinc-400">or your full balance {fmt(balance)}</div>}
        <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{zelleMemo}</div>
      </div>
      <button
        type="button"
        disabled={working}
        onClick={async () => {
          setWorking(true);
          try {
            await fetch("/api/pay/zelle-pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, amount: suggested }) });
            setClaimed(true);
          } finally {
            setWorking(false);
          }
        }}
        className="w-full rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110 disabled:opacity-60"
      >
        {working ? "One sec…" : "I've sent my Zelle payment"}
      </button>
      {onBack && <button type="button" onClick={onBack} className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600">← choose another method</button>}
    </div>
  );
}
