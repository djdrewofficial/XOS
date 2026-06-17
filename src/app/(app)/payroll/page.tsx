import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import { staffHours, staffCost, payPeriodFor, fmtPeriod } from "@/lib/payroll";
import {
  savePayrollSettings,
  generatePayables,
  logPayment,
  addManualPayable,
  removePayable,
  approveTimesheetChange,
  denyTimesheetChange,
} from "./actions";

export const dynamic = "force-dynamic";

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const supabase = await createClient();

  // guard — admins only
  const { data: auth } = await supabase.auth.getUser();
  const { data: me } = auth?.user
    ? await supabase.from("employees").select("permission_tier").eq("auth_user_id", auth.user.id).maybeSingle()
    : { data: null };
  const tier = (me?.permission_tier as string | undefined) ?? "master_admin";
  if (tier !== "master_admin" && tier !== "admin") redirect("/");

  const { period: periodParam } = await searchParams;
  const { data: settings } = await supabase.from("payroll_settings").select("*").eq("id", true).maybeSingle();
  const frequency = (settings?.frequency as string) ?? "biweekly";
  const anchor = settings?.anchor_payday as string | null;
  const today = new Date().toISOString().slice(0, 10);
  const period = anchor ? payPeriodFor(anchor, frequency, periodParam ?? today) : null;

  // ---- settings panel (always shown) ----
  const settingsPanel = (
    <div className="card p-5">
      <h2 className="card-title">Payroll Schedule</h2>
      <form action={savePayrollSettings} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-xs">Frequency</label>
          <select name="frequency" defaultValue={frequency} className="input w-44">
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every two weeks</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div>
          <label className="label-xs">First pay day</label>
          <input type="date" name="anchor_payday" defaultValue={anchor ?? ""} className="input w-44" />
        </div>
        <button className="btn-primary px-4 py-2 text-sm">Save</button>
        {period && (
          <span className="pb-2 text-xs text-zinc-500">
            Next paydays: {fmtDate(period.payday)} · {fmtDate(period.nextPayday)}
          </span>
        )}
      </form>
    </div>
  );

  if (!period) {
    return (
      <div className="max-w-5xl space-y-5">
        <h1 className="page-title">Payroll</h1>
        {settingsPanel}
        <p className="text-sm text-zinc-500">Set a first pay day above to start tracking pay periods.</p>
      </div>
    );
  }

  // ---- estimate: staff on events in this period ----
  const { data: events } = await supabase
    .from("events")
    .select(
      "id, name, event_date, setup_time, start_time, end_time, venue:venues(name, travel_minutes), event_staff(id, role, pay_type, flat_wage, start_time, end_time, checked_in_at, checked_out_at, employee:employees(first_name, last_name, hourly_rate))"
    )
    .is("archived_at", null)
    .gte("event_date", period.periodStart)
    .lte("event_date", period.periodEnd)
    .order("event_date");

  type EstRow = { staff: string; event: string; eventId: string; date: string; hours: number; rate: string; cost: number; actual: boolean };
  const estRows: EstRow[] = [];
  for (const ev of events ?? []) {
    const travel = (ev.venue as unknown as { travel_minutes?: number | null } | null)?.travel_minutes ?? 0;
    for (const es of (ev.event_staff ?? []) as Array<Record<string, unknown>>) {
      const emp = es.employee as { first_name?: string; last_name?: string; hourly_rate?: number | null } | null;
      const actual = !!(es.checked_in_at && es.checked_out_at);
      const hours = staffHours(es, ev, travel, { actual });
      const cost = staffCost(es, emp, hours);
      estRows.push({
        staff: `${emp?.first_name ?? ""} ${emp?.last_name ?? ""}`.trim() || "—",
        event: (ev.name as string) || "(unnamed)",
        eventId: ev.id as string,
        date: ev.event_date as string,
        hours,
        rate: (es.pay_type as string) === "flat" ? "flat" : `$${Number(emp?.hourly_rate ?? 0)}/hr`,
        cost,
        actual,
      });
    }
  }
  const estTotal = estRows.reduce((s, r) => s + r.cost, 0);

  // ---- payables ledger for this payday ----
  const { data: payables } = await supabase
    .from("payroll_payables")
    .select("*, employee:employees(first_name, last_name), vendor:vendors(company_name), event:events(name), payments:payroll_payments(amount)")
    .eq("pay_period", period.payday)
    .order("created_at");

  const ledger = (payables ?? []).map((p) => {
    const paid = ((p.payments as { amount: number }[] | null) ?? []).reduce((s, x) => s + Number(x.amount), 0);
    const owed = Number(p.amount_owed);
    const emp = p.employee as { first_name?: string; last_name?: string } | null;
    const ven = p.vendor as { company_name?: string } | null;
    const payee = emp ? `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() : ven?.company_name ?? (p.payee_name as string) ?? "—";
    const remaining = Math.max(0, Math.round((owed - paid) * 100) / 100);
    const status = paid <= 0 ? "pending" : paid + 0.005 >= owed ? "paid" : "partial";
    return { id: p.id as string, payee, kind: p.payee_kind as string, event: (p.event as { name?: string } | null)?.name ?? null, desc: p.description as string | null, owed, paid, remaining, status, source: p.source as string };
  });
  const ledgerOwed = ledger.reduce((s, r) => s + r.owed, 0);
  const ledgerPaid = ledger.reduce((s, r) => s + r.paid, 0);

  // ---- pending change requests + form data ----
  const { data: changeReqs } = await supabase
    .from("timesheet_change_requests")
    .select("*, event_staff(role, employee:employees(first_name, last_name), event:events(name))")
    .eq("status", "pending")
    .order("created_at");

  const [{ data: vendors }, { data: employees }] = await Promise.all([
    supabase.from("vendors").select("id, company_name").order("company_name"),
    supabase.from("employees").select("id, first_name, last_name").eq("is_active", true).order("first_name"),
  ]);

  const statusChip = (s: string) =>
    s === "paid"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
      : s === "partial"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
      : "bg-zinc-200 text-zinc-600 dark:bg-white/10 dark:text-zinc-300";

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Payroll</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/payroll?period=${period.prevPayday}`} className="btn-ghost px-3 py-1.5 text-xs">←</Link>
          <span className="font-semibold">Pay day {fmtDate(period.payday)}</span>
          <Link href={`/payroll?period=${period.nextPayday}`} className="btn-ghost px-3 py-1.5 text-xs">→</Link>
        </div>
      </div>
      <p className="-mt-3 text-xs text-zinc-500">Period {fmtPeriod(period)} · paid {fmtDate(period.payday)}</p>

      {settingsPanel}

      {/* ---- estimate ---- */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="card-title mb-0">Estimated payroll this period</h2>
          <span className="text-lg font-black text-zinc-900 dark:text-white">{money(estTotal)}</span>
        </div>
        {estRows.length === 0 ? (
          <p className="text-sm text-zinc-500">No staffed events in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-2 py-1.5 text-left">Staff</th>
                <th className="px-2 py-1.5 text-left">Event</th>
                <th className="px-2 py-1.5 text-right">Hours</th>
                <th className="px-2 py-1.5 text-left">Rate</th>
                <th className="px-2 py-1.5 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {estRows.map((r, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">{r.staff}</td>
                  <td className="px-2 py-1.5">
                    <Link href={`/events/${r.eventId}`} className="text-brand hover:underline dark:text-brand-lighter">{r.event}</Link>
                    <span className="ml-1 text-xs text-zinc-400">{r.date}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {r.rate === "flat" ? "—" : r.hours.toFixed(1)}
                    {r.actual && r.rate !== "flat" && <span className="ml-1 text-[10px] text-emerald-600">actual</span>}
                  </td>
                  <td className="px-2 py-1.5">{r.rate}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{money(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- payments ledger ---- */}
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title mb-0">Pending payments</h2>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>Owed {money(ledgerOwed)} · Paid {money(ledgerPaid)} · Remaining {money(ledgerOwed - ledgerPaid)}</span>
            <form action={generatePayables.bind(null, period.payday, period.periodStart, period.periodEnd)}>
              <button className="btn-ghost px-3 py-1.5 text-xs">Generate staff payables</button>
            </form>
          </div>
        </div>

        {ledger.length === 0 ? (
          <p className="text-sm text-zinc-500">No payables yet — &quot;Generate staff payables&quot; pulls this period&apos;s staff cost, or add a manual one below.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {ledger.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{r.payee}</span>
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusChip(r.status)}`}>{r.status}</span>
                  <div className="text-xs text-zinc-500">
                    {r.kind}
                    {r.event ? ` · ${r.event}` : ""}
                    {r.desc ? ` · ${r.desc}` : ""} · owed {money(r.owed)} · paid {money(r.paid)}
                    {r.remaining > 0 ? ` · remaining ${money(r.remaining)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.status !== "paid" && (
                    <form action={logPayment.bind(null, r.id)} className="flex items-center gap-1">
                      <input type="number" step="0.01" name="amount" defaultValue={r.remaining.toFixed(2)} className="input w-24 py-1 text-xs" />
                      <input name="method" placeholder="method" className="input w-24 py-1 text-xs" />
                      <button className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Log payment</button>
                    </form>
                  )}
                  <form action={removePayable.bind(null, r.id)}>
                    <button className="text-xs text-red-500 hover:underline">✕</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* add manual payable */}
        <form action={addManualPayable.bind(null, period.payday)} className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3 dark:border-white/[0.06]">
          <div>
            <label className="label-xs">Type</label>
            <select name="payee_kind" className="input w-32 py-1.5 text-sm">
              <option value="vendor">Vendor</option>
              <option value="contractor">Contractor</option>
              <option value="employee">Employee</option>
            </select>
          </div>
          <div>
            <label className="label-xs">Vendor</label>
            <select name="vendor_id" className="input w-40 py-1.5 text-sm">
              <option value="">—</option>
              {(vendors ?? []).map((v) => (<option key={v.id} value={v.id}>{v.company_name}</option>))}
            </select>
          </div>
          <div>
            <label className="label-xs">or Employee</label>
            <select name="employee_id" className="input w-40 py-1.5 text-sm">
              <option value="">—</option>
              {(employees ?? []).map((e) => (<option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>))}
            </select>
          </div>
          <div>
            <label className="label-xs">or Name</label>
            <input name="payee_name" placeholder="Contractor name" className="input w-36 py-1.5 text-sm" />
          </div>
          <div>
            <label className="label-xs">Amount</label>
            <input type="number" step="0.01" name="amount_owed" className="input w-24 py-1.5 text-sm" />
          </div>
          <button className="btn-ghost px-3 py-2 text-xs">Add payable</button>
        </form>
      </div>

      {/* ---- timesheet change requests ---- */}
      {(changeReqs ?? []).length > 0 && (
        <div className="card p-5">
          <h2 className="card-title">Timesheet change requests</h2>
          <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {(changeReqs ?? []).map((req) => {
              const es = req.event_staff as { role?: string; employee?: { first_name?: string; last_name?: string } | null; event?: { name?: string } | null } | null;
              const who = `${es?.employee?.first_name ?? ""} ${es?.employee?.last_name ?? ""}`.trim() || "Staff";
              return (
                <li key={req.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <span className="font-medium">{who}</span> · {es?.event?.name ?? "event"}
                    <div className="text-xs text-zinc-500">
                      Requested in {fmtDT(req.requested_check_in)} · out {fmtDT(req.requested_check_out)}
                      {req.reason ? ` · "${req.reason}"` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <form action={approveTimesheetChange.bind(null, req.id)}>
                      <button className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Approve</button>
                    </form>
                    <form action={denyTimesheetChange.bind(null, req.id)}>
                      <button className="rounded-md bg-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-300 dark:bg-white/10 dark:text-zinc-300">Deny</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
