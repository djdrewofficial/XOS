import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Section, Row, Note, CheckBoxField } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import Tabs from "@/components/Tabs";
import { paypalConfigStatus } from "@/lib/paypal";
import { savePaymentSettings } from "./actions";

export const dynamic = "force-dynamic";

const AUTOFILL_OPTIONS = [
  ["disabled", "Disabled"],
  ["retainer_fee", "Retainer Fee (first scheduled payment)"],
  ["next_scheduled", "Next Scheduled Payment"],
  ["balance_due", "Remaining Balance"],
] as const;

type PaymentSettings = {
  payment_methods: string[];
  expense_payment_methods: string[];
  payment_reasons: string[];
  prefill_reasons: string[];
  autofill_no_payments: string;
  autofill_after_payments: string;
  past_due_adjust_days: number;
  online_pay_enabled?: boolean;
  paypal_pay_enabled?: boolean;
  paypal_fee_pct?: number;
  zelle_pay_enabled?: boolean;
  zelle_display_name?: string;
  zelle_handle?: string | null;
  zelle_memo?: string;
  require_pay_verification?: boolean;
};

export default async function PaymentSettingsPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("payment_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  if (!settings) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Payment Settings</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00028_payment_settings.sql</code>{" "}
            in the Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const s = settings as PaymentSettings;

  // PayPal env health — makes a silent sandbox-on-prod / missing-webhook misconfig
  // visible before onboarding. Mirrors the fail-closed guard in the order routes.
  const paypal = paypalConfigStatus();
  const paypalCritical = paypal.configured && paypal.deployedHost && !paypal.live;
  const paypalBanner: { tone: "red" | "amber" | "green"; title: string; lines: string[] } | null = !paypal.configured
    ? paypal.deployedHost
      ? {
          tone: "amber",
          title: "PayPal isn’t configured",
          lines: [
            "Card payments won’t work until PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and NEXT_PUBLIC_PAYPAL_CLIENT_ID are set in Netlify.",
          ],
        }
      : null
    : paypal.issues.length
      ? {
          tone: paypalCritical ? "red" : "amber",
          title: paypalCritical ? "PayPal is NOT ready for live payments" : "PayPal configuration warning",
          lines: paypal.issues,
        }
      : {
          tone: "green",
          title: `PayPal is ${paypal.live ? "LIVE" : "in sandbox (dev)"}${
            paypal.live && paypal.webhookVerification ? " · webhook signature verification on" : ""
          }`,
          lines: [],
        };
  const bannerTone: Record<"red" | "amber" | "green", string> = {
    red: "border-red-300 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200",
    amber: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200",
    green: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200",
  };

  return (
    <div className="max-w-[1700px]">
      <h1 className="page-title mb-5">Payment Settings</h1>
      {paypalBanner && (
        <div className={`mb-5 rounded-lg border p-4 text-sm ${bannerTone[paypalBanner.tone]}`}>
          <p className="font-semibold">
            {paypalBanner.tone === "green" ? "✓ " : "⚠ "}
            {paypalBanner.title}
          </p>
          {paypalBanner.lines.length > 0 && (
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {paypalBanner.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {paypalCritical && (
            <p className="mt-2 text-xs opacity-90">
              While this is unresolved, the pay page refuses card orders (fail-safe) so no client can pay into the
              sandbox — they’re asked to contact you instead.
            </p>
          )}
        </div>
      )}
      <form action={savePaymentSettings} className="space-y-5">
        <Tabs
          tabs={[
            { id: "recording", label: "Recording Payments", content: (
              <div className="space-y-5">
        <Section title="Payment Methods">
          <Row
            label="Client Payment Methods"
            hint="One per line — these options appear when entering a payment on an event"
          >
            <textarea
              name="payment_methods"
              defaultValue={(s.payment_methods ?? []).join("\n")}
              rows={6}
              className="input w-full max-w-md font-mono text-sm"
            />
          </Row>
          <Row
            label="Expense Payment Methods"
            hint="Method options for employee wages and business expenses"
          >
            <textarea
              name="expense_payment_methods"
              defaultValue={(s.expense_payment_methods ?? []).join("\n")}
              rows={4}
              className="input w-full max-w-md font-mono text-sm"
            />
          </Row>
        </Section>

        <Section title="Auto-Fill Amount When Adding A Payment">
          <Row label="No Payments Have Been Made" hint="Pre-fill the amount field with this value">
            <select name="autofill_no_payments" defaultValue={s.autofill_no_payments} className="input w-full max-w-md">
              {AUTOFILL_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Row>
          <Row label="At Least One Payment Has Been Made">
            <select name="autofill_after_payments" defaultValue={s.autofill_after_payments} className="input w-full max-w-md">
              {AUTOFILL_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Row>
          <Note>
            Retainer / scheduled amounts come from the event&apos;s payment schedule, generated from the package&apos;s
            payment rules — see{" "}
            <Link href="/packages" className="font-semibold text-brand underline dark:text-brand-lighter">Packages</Link>.
          </Note>
        </Section>

        <Section title="Reasons For Payment">
          <Row label="Options" hint="One per line — shown in the reason dropdown when entering a payment">
            <textarea
              name="payment_reasons"
              defaultValue={(s.payment_reasons ?? []).join("\n")}
              rows={6}
              className="input w-full max-w-md font-mono text-sm"
            />
          </Row>
          <Note>
            Pre-fill the reason field with these values based on the number of payments already made. This applies to
            MANUALLY ADDED payments only — leave blank to skip pre-filling.
          </Note>
          {[
            ["prefill_0", "no payments"],
            ["prefill_1", "1 payment"],
            ["prefill_2", "2+ payments"],
          ].map(([name, hint], i) => (
            <Row key={name} label={`Pre-fill (${hint})`}>
              <input name={name} defaultValue={s.prefill_reasons?.[i] ?? ""} className="input w-full max-w-md" />
            </Row>
          ))}
        </Section>

        <Section title="Past Due Date Adjustment">
          <Row
            label="Days Before/After Event Date"
            hint="0 = final balance due on the event date. Positive = due X days after the event. Negative = due X days before the event."
          >
            <input
              type="number"
              name="past_due_adjust_days"
              defaultValue={s.past_due_adjust_days}
              className="input w-28"
            />
          </Row>
          <Note>
            Each package can also set its own balance-due terms (days before the event or Net-N after) — package rules
            take precedence when generating an event&apos;s payment schedule.
          </Note>
        </Section>

              </div>
            ) },
            { id: "online", label: "Online Payment Page", content: (
              <div className="space-y-5">
        <Section title="Online Payment Page (Client-Facing)">
          <Note>
            Controls the public <code className="rounded bg-black/5 px-1 dark:bg-white/10">/welcome</code> page clients
            land on after signing — their payment options and the card fee.
          </Note>
          <Row label="Enable Online Payments" hint="Master switch for the welcome / pay page">
            <CheckBoxField name="online_pay_enabled" label="Enabled" defaultChecked={s.online_pay_enabled ?? true} />
          </Row>
          <Row
            label="Require Phone Verification"
            hint="Before paying, clients enter the mobile number on file and a 6-digit code we text them. Blocks spam/fraud attempts. Auto-skipped if SMS isn't configured."
          >
            <CheckBoxField name="require_pay_verification" label="Enabled" defaultChecked={s.require_pay_verification ?? true} />
          </Row>
          <Row label="Accept Card / PayPal / Venmo">
            <CheckBoxField name="paypal_pay_enabled" label="Enabled" defaultChecked={s.paypal_pay_enabled ?? true} />
          </Row>
          <Row
            label="Card Convenience Fee (%)"
            hint="Added on top of card/PayPal/Venmo payments and disclosed to the client. Zelle is free."
          >
            <input type="number" step="0.01" name="paypal_fee_pct" defaultValue={s.paypal_fee_pct ?? 4} className="input w-28" />
          </Row>
          <Row label="Accept Zelle">
            <CheckBoxField name="zelle_pay_enabled" label="Enabled" defaultChecked={s.zelle_pay_enabled ?? true} />
          </Row>
          <Row label="Zelle Recipient Name">
            <input name="zelle_display_name" defaultValue={s.zelle_display_name ?? ""} className="input w-full max-w-md" placeholder="Xpress Entertainment" />
          </Row>
          <Row label="Zelle Email or Phone" hint="The email/number your Zelle is registered to — shown to clients">
            <input name="zelle_handle" defaultValue={s.zelle_handle ?? ""} className="input w-full max-w-md" placeholder="payments@xpressdjs.com" />
          </Row>
          <Row label="Zelle Memo Instruction">
            <input name="zelle_memo" defaultValue={s.zelle_memo ?? ""} className="input w-full max-w-md" placeholder="Include your event date in the memo" />
          </Row>
          <Note>
            Heads up: surcharging card payments has card-network (Visa caps card surcharges at 3%) and PayPal-policy
            limits — check your processor&apos;s terms before setting a fee. The fee is always disclosed before payment.
          </Note>
        </Section>
              </div>
            ) },
          ]}
        />

        <div className="flex justify-end">
          <SaveButton>Save Settings</SaveButton>
        </div>
      </form>
    </div>
  );
}
