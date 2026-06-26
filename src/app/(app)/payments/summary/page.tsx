import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money, eventTotal, type XEvent } from "@/lib/types";
import { staffHours, staffCost } from "@/lib/payroll";

export const dynamic = "force-dynamic";

/* Income & Expense Summary by month — events grouped by event date, restricted
   to statuses that count toward Financials. Future months are "(projected)". */

type Row = {
  month: number;
  label: string;
  events: number;
  income: number;
  wages: number;
  expenses: number;
  payments: number;
};

export default async function IncomeExpensePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year } = await searchParams;
  const y = parseInt(year ?? "") || new Date().getFullYear();
  const supabase = await createClient();
  const now = new Date();

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, event_date, archived_at, package_price_override, package_price_locked, overtime_fee, travel_fee, discount1_amount, discount2_amount, setup_time, start_time, end_time, " +
        "status:event_statuses(counts_financial), package:packages(default_price), venue:venues(setup_fee, travel_minutes), " +
        "event_addons(quantity, price_override, price_locked, addon:addons(default_price)), " +
        "event_staff(pay_type, flat_wage, start_time, end_time, checked_in_at, checked_out_at, employee:employees(hourly_rate)), " +
        "payments(amount, status), expenses(amount)"
    )
    .gte("event_date", `${y}-01-01`)
    .lte("event_date", `${y}-12-31`);

  const months: Row[] = Array.from({ length: 12 }, (_, i) => ({
    month: i,
    label: new Date(y, i, 1).toLocaleString("en-US", { month: "long" }),
    events: 0,
    income: 0,
    wages: 0,
    expenses: 0,
    payments: 0,
  }));

  for (const ev of (events ?? []) as unknown as Array<Record<string, unknown>>) {
    if (ev.archived_at) continue;
    if (!(ev.status as { counts_financial?: boolean } | null)?.counts_financial) continue; // financials statuses only
    const date = ev.event_date as string | null;
    if (!date) continue;
    const m = new Date(`${date}T00:00:00`).getMonth();

    const addonsTotal = ((ev.event_addons ?? []) as Array<Record<string, unknown>>).reduce((s, a) => {
      const unit = (a.price_override as number) ?? (a.price_locked as number) ?? (a.addon as { default_price?: number } | null)?.default_price ?? 0;
      return s + Number(a.quantity) * Number(unit);
    }, 0);
    const venueSetup = Number((ev.venue as { setup_fee?: number } | null)?.setup_fee ?? 0);
    const income = eventTotal(ev as unknown as XEvent) + addonsTotal + venueSetup;

    const travel = (ev.venue as { travel_minutes?: number | null } | null)?.travel_minutes ?? 0;
    const wages = ((ev.event_staff ?? []) as Array<Record<string, unknown>>).reduce((s, es) => {
      const emp = es.employee as { hourly_rate?: number | null } | null;
      const hrs = staffHours(es, ev, travel, { actual: !!(es.checked_in_at && es.checked_out_at) });
      return s + staffCost(es, emp, hrs);
    }, 0);

    const expenses = ((ev.expenses ?? []) as Array<{ amount: number }>).reduce((s, x) => s + Number(x.amount), 0);
    const payments = ((ev.payments ?? []) as Array<{ amount: number; status: string }>)
      .filter((p) => p.status === "approved")
      .reduce((s, p) => s + Number(p.amount), 0);

    months[m].events += 1;
    months[m].income += income;
    months[m].wages += wages;
    months[m].expenses += expenses;
    months[m].payments += payments;
  }

  const isProjected = (m: number) => y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth());
  const profit = (r: Row) => r.income - r.wages - r.expenses;
  const tot = months.reduce(
    (a, r) => ({ events: a.events + r.events, income: a.income + r.income, wages: a.wages + r.wages, expenses: a.expenses + r.expenses, payments: a.payments + r.payments }),
    { events: 0, income: 0, wages: 0, expenses: 0, payments: 0 }
  );
  const anyProjected = months.some((r) => r.events > 0 && isProjected(r.month));

  return (
    <div className="max-w-[1700px]">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Income &amp; Expense — {y}</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/payments/summary?year=${y - 1}`} className="btn-ghost px-3 py-1">← {y - 1}</Link>
          <Link href={`/payments/summary?year=${y + 1}`} className="btn-ghost px-3 py-1">{y + 1} →</Link>
          <a href={`/api/reports/summary?year=${y}`} target="_blank" rel="noopener" className="btn-ghost px-3 py-1.5 text-sm">🖨 Export PDF</a>
        </div>
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        Grouped by event date · only statuses that count toward Financials · &quot;projected&quot; months are upcoming.
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-3 py-2 text-left">Month</th>
              <th className="px-3 py-2 text-right">Events</th>
              <th className="px-3 py-2 text-right">Avg Fee</th>
              <th className="px-3 py-2 text-right">Event Income</th>
              <th className="px-3 py-2 text-right">Wages</th>
              <th className="px-3 py-2 text-right">Expenses</th>
              <th className="px-3 py-2 text-right">Payments</th>
              <th className="px-3 py-2 text-right">Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {months.map((r) => (
              <tr key={r.month}>
                <td className="px-3 py-2">
                  {r.label}
                  {isProjected(r.month) && <span className="ml-1 text-xs text-zinc-400">(projected)</span>}
                </td>
                <td className="px-3 py-2 text-right">{r.events}</td>
                <td className="px-3 py-2 text-right text-zinc-500">{r.events ? money(r.income / r.events) : "—"}</td>
                <td className="px-3 py-2 text-right">{money(r.income)}</td>
                <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{r.wages ? `−${money(r.wages)}` : money(0)}</td>
                <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{r.expenses ? `−${money(r.expenses)}` : money(0)}</td>
                <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{money(r.payments)}</td>
                <td className="px-3 py-2 text-right font-semibold">{money(profit(r))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-amber-100 font-bold dark:bg-amber-500/15">
              <td className="px-3 py-2.5">Total{anyProjected ? " (projected)" : ""}</td>
              <td className="px-3 py-2.5 text-right">{tot.events}</td>
              <td className="px-3 py-2.5 text-right">{tot.events ? money(tot.income / tot.events) : "—"}</td>
              <td className="px-3 py-2.5 text-right">{money(tot.income)}</td>
              <td className="px-3 py-2.5 text-right text-red-700 dark:text-red-300">−{money(tot.wages)}</td>
              <td className="px-3 py-2.5 text-right text-red-700 dark:text-red-300">−{money(tot.expenses)}</td>
              <td className="px-3 py-2.5 text-right text-emerald-700 dark:text-emerald-300">{money(tot.payments)}</td>
              <td className="px-3 py-2.5 text-right">{money(tot.income - tot.wages - tot.expenses)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
