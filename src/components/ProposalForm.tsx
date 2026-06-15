"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { buildScheduleRows, type SchedulePlan, type ScheduleRow } from "@/lib/paymentSchedule";
import type { ProposalLayout, PaymentChooser } from "@/lib/journeyConfig";
import { confirmProposal } from "@/app/proposal/[token]/actions";

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDate = (d: string | null) => {
  if (!d) return "TBD";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

type Contact = { first: string; last: string; email: string; cell: string };

export type ProposalFormProps = {
  token: string;
  layout: ProposalLayout;
  mode: PaymentChooser;
  a: Contact;
  b: Contact;
  organization: string;
  venue: { name: string; address: string };
  timing: { date: string; setup: string; start: string; end: string };
  quoteHtml: string;
  // client mode (couple picks)
  total: number;
  deposit: number;
  allowedSplits: number[];
  terms: "days_before" | "net_days_after";
  termsDays: number;
  // office mode (we set it) — schedule computed server-side
  officeRows: ScheduleRow[];
  officeLabel: string;
};

function Input({ label, name, defaultValue, type = "text" }: { label: string; name: string; defaultValue: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand dark:border-white/15 dark:bg-zinc-800 dark:text-white"
      />
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-sm font-bold text-zinc-900 dark:text-white">{children}</h2>;
}

function ScheduleTable({ rows }: { rows: ScheduleRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-white/[0.04]">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Payment</th>
            <th className="px-3 py-1.5 text-left font-medium">Due</th>
            <th className="px-3 py-1.5 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.05]">
          {rows.map((r) => (
            <tr key={r.seq}>
              <td className="px-3 py-1.5">{r.label}</td>
              <td className="px-3 py-1.5 text-zinc-500">{fmtDate(r.due_date)}</td>
              <td className="px-3 py-1.5 text-right font-semibold">{fmt(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Preparing your agreement…" : "Confirm & Continue to Sign →"}
    </button>
  );
}

export default function ProposalForm(props: ProposalFormProps) {
  const [eventDate, setEventDate] = useState(props.timing.date);
  const [plan, setPlan] = useState<string>(props.allowedSplits.length ? `split:${props.allowedSplits[0]}` : "full");

  const parsedPlan: SchedulePlan = plan.startsWith("split:")
    ? { kind: "split", count: parseInt(plan.slice(6), 10) || 1 }
    : { kind: "full" };

  const preview = useMemo(
    () =>
      buildScheduleRows({
        total: props.total,
        deposit: props.deposit,
        eventDate: eventDate || null,
        terms: props.terms,
        termsDays: props.termsDays,
        plan: parsedPlan,
        today: new Date().toISOString().slice(0, 10),
      }),
    [props.total, props.deposit, eventDate, props.terms, props.termsDays, plan] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const isClient = props.mode === "client";
  const isSplit = parsedPlan.kind === "split";
  const officeHasFuture = props.officeRows.some((r) => r.due_date && r.due_date > new Date().toISOString().slice(0, 10));
  const showAutopay = isClient ? isSplit : officeHasFuture;

  const planOptions: { value: string; label: string; sub: string }[] = [
    { value: "full", label: "Pay in full", sub: "One payment — settle the whole investment now" },
    ...props.allowedSplits.map((n) => ({
      value: `split:${n}`,
      label: n === 1 ? "Deposit + final payment" : `Deposit + ${n} payments`,
      sub: `Retainer today, balance ${props.termsDays} days before your event`,
    })),
  ];

  return (
    <form action={confirmProposal.bind(null, props.token)} className="space-y-6">
      {/* ---- quote summary (read-only) ---- */}
      {props.quoteHtml && (
        <div>
          <SectionLabel>Your Quote</SectionLabel>
          <div
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-white/10 dark:bg-white/[0.03] [&_table]:w-full [&_td]:py-0.5 [&_th]:text-left [&_th]:text-zinc-500"
            dangerouslySetInnerHTML={{ __html: props.quoteHtml }}
          />
        </div>
      )}

      {/* ---- contacts (layout-driven) ---- */}
      {props.layout === "business" ? (
        <div>
          <SectionLabel>Your Organization</SectionLabel>
          <div className="space-y-3">
            <Input label="Organization / company" name="organization" defaultValue={props.organization} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Contact first name" name="a_first" defaultValue={props.a.first} />
              <Input label="Contact last name" name="a_last" defaultValue={props.a.last} />
              <Input label="Email" name="a_email" defaultValue={props.a.email} type="email" />
              <Input label="Phone" name="a_cell" defaultValue={props.a.cell} type="tel" />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div>
            <SectionLabel>Your Information</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Input label="First name" name="a_first" defaultValue={props.a.first} />
              <Input label="Last name" name="a_last" defaultValue={props.a.last} />
              <Input label="Email" name="a_email" defaultValue={props.a.email} type="email" />
              <Input label="Cell phone" name="a_cell" defaultValue={props.a.cell} type="tel" />
            </div>
          </div>
          <div>
            <SectionLabel>Your Partner</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Input label="First name" name="b_first" defaultValue={props.b.first} />
              <Input label="Last name" name="b_last" defaultValue={props.b.last} />
              <Input label="Email" name="b_email" defaultValue={props.b.email} type="email" />
              <Input label="Cell phone" name="b_cell" defaultValue={props.b.cell} type="tel" />
            </div>
          </div>
        </>
      )}

      {/* ---- Venue ---- */}
      <div>
        <SectionLabel>Venue</SectionLabel>
        <div className="space-y-3">
          <Input label="Venue name" name="venue_name" defaultValue={props.venue.name} />
          <Input label="Venue address" name="venue_address" defaultValue={props.venue.address} />
        </div>
      </div>

      {/* ---- Timing ---- */}
      <div>
        <SectionLabel>Event Day</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Event date</span>
            <input
              name="event_date"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand dark:border-white/15 dark:bg-zinc-800 dark:text-white"
            />
          </label>
          <Input label="Setup time" name="setup_time" defaultValue={props.timing.setup} type="time" />
          <Input label="Start time" name="start_time" defaultValue={props.timing.start} type="time" />
          <Input label="End time" name="end_time" defaultValue={props.timing.end} type="time" />
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">Times can be estimates — we&apos;ll finalize them with you later.</p>
      </div>

      {/* ---- Payment ---- */}
      <div>
        <SectionLabel>Payment</SectionLabel>
        {isClient ? (
          <>
            <div className="space-y-2">
              {planOptions.map((o) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
                    plan === o.value
                      ? "border-brand bg-brand/5 dark:border-brand-light"
                      : "border-zinc-300 hover:border-brand/50 dark:border-white/15"
                  }`}
                >
                  <input
                    type="radio"
                    name="plan"
                    value={o.value}
                    checked={plan === o.value}
                    onChange={() => setPlan(o.value)}
                    className="mt-0.5 size-4 accent-brand-light"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-zinc-900 dark:text-white">{o.label}</span>
                    <span className="block text-xs text-zinc-500">{o.sub}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3">
              <ScheduleTable rows={preview} />
            </div>
          </>
        ) : (
          <>
            <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">{props.officeLabel}</p>
            <ScheduleTable rows={props.officeRows} />
          </>
        )}
      </div>

      {/* ---- Autopay ---- */}
      {showAutopay && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 dark:border-white/15 dark:bg-white/[0.03]">
          <input type="checkbox" name="autopay" className="mt-0.5 size-4 accent-brand-light" />
          <span className="text-xs text-zinc-600 dark:text-zinc-300">
            <span className="font-semibold text-zinc-900 dark:text-white">Enroll in automatic payments.</span> I authorize
            Xpress Entertainment to automatically charge my saved payment method for each scheduled payment on its due
            date. I can cancel anytime by contacting the office.
          </span>
        </label>
      )}

      <Submit />
      <p className="text-center text-[11px] text-zinc-400">
        Next you&apos;ll review and electronically sign your agreement.
      </p>
    </form>
  );
}
