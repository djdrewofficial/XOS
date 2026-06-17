import { createClient } from "@/lib/supabase/server";
import { money, eventTotal, type XEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

/* Monthly Breakdown — event income by month across years, with a year-over-year
   comparison of the two most recent years. Financials-counting statuses only,
   grouped by event date. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type YearData = { income: number[]; count: number[] };

export default async function MonthlyBreakdownPage() {
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("events")
    .select(
      "event_date, archived_at, package_price_override, package_price_locked, overtime_fee, travel_fee, discount1_amount, discount2_amount, " +
        "status:event_statuses(counts_financial), package:packages(default_price), venue:venues(setup_fee), " +
        "event_addons(quantity, price_override, price_locked, addon:addons(default_price))"
    )
    .not("event_date", "is", null)
    .limit(5000);

  const byYear = new Map<number, YearData>();
  const ensure = (y: number) => {
    if (!byYear.has(y)) byYear.set(y, { income: Array(12).fill(0), count: Array(12).fill(0) });
    return byYear.get(y)!;
  };

  for (const ev of (events ?? []) as unknown as Array<Record<string, unknown>>) {
    if (ev.archived_at) continue;
    if (!(ev.status as { counts_financial?: boolean } | null)?.counts_financial) continue;
    const date = ev.event_date as string;
    const d = new Date(`${date}T00:00:00`);
    const y = d.getFullYear();
    const m = d.getMonth();
    const addonsTotal = ((ev.event_addons ?? []) as Array<Record<string, unknown>>).reduce((s, a) => {
      const unit = (a.price_override as number) ?? (a.price_locked as number) ?? (a.addon as { default_price?: number } | null)?.default_price ?? 0;
      return s + Number(a.quantity) * Number(unit);
    }, 0);
    const venueSetup = Number((ev.venue as { setup_fee?: number } | null)?.setup_fee ?? 0);
    const income = eventTotal(ev as unknown as XEvent) + addonsTotal + venueSetup;
    const yd = ensure(y);
    yd.income[m] += income;
    yd.count[m] += 1;
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  const sum = (arr: number[]) => arr.reduce((s, n) => s + n, 0);

  // per-month totals across all years
  const monthIncomeTotal = Array.from({ length: 12 }, (_, m) => years.reduce((s, y) => s + byYear.get(y)!.income[m], 0));
  const monthCountTotal = Array.from({ length: 12 }, (_, m) => years.reduce((s, y) => s + byYear.get(y)!.count[m], 0));

  // YoY: two most recent years
  const cur = years.length ? years[years.length - 1] : null;
  const prev = years.length > 1 ? years[years.length - 2] : null;

  const cell = "border-l border-zinc-100 px-2 py-1.5 text-right dark:border-white/[0.06]";
  const headCell = "border-l border-zinc-200 px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:border-white/[0.08]";
  const pctColor = (n: number) => (n > 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : n < 0 ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "text-zinc-400");
  const fmtPct = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? "0%" : "—") : `${cur - prev >= 0 ? "+" : ""}${(((cur - prev) / Math.abs(prev)) * 100).toFixed(1)}%`);

  return (
    <div className="max-w-full">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Monthly Breakdown</h1>
        <a href="/api/reports/monthly" target="_blank" rel="noopener" className="btn-ghost px-3 py-1.5 text-sm">🖨 Export PDF</a>
      </div>
      <p className="mb-4 text-xs text-zinc-500">Event income by event date · Financials-counting statuses only.</p>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-zinc-500">Year</th>
              {MONTHS.map((m) => (
                <th key={m} className={headCell}>{m}</th>
              ))}
              <th className={headCell}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {years.map((y) => {
              const yd = byYear.get(y)!;
              return (
                <tr key={y}>
                  <td className="bg-zinc-100 px-3 py-1.5 font-bold dark:bg-white/[0.05]">{y}</td>
                  {MONTHS.map((_, m) => (
                    <td key={m} className={cell}>
                      <div>{money(yd.income[m])}</div>
                      <div className="text-[11px] text-zinc-400">{yd.count[m]}</div>
                    </td>
                  ))}
                  <td className={`${cell} font-semibold`}>
                    <div>{money(sum(yd.income))}</div>
                    <div className="text-[11px] text-zinc-400">{sum(yd.count)}</div>
                  </td>
                </tr>
              );
            })}

            {/* Year-over-Year comparison (most recent two years) */}
            {cur !== null && prev !== null && (
              <>
                <tr>
                  <td className="px-3 py-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-300">
                    Fees Δ<div className="text-[10px] font-normal text-zinc-400">{cur} vs {prev}</div>
                  </td>
                  {MONTHS.map((_, m) => {
                    const c = byYear.get(cur)!.income[m];
                    const p = byYear.get(prev)!.income[m];
                    return (
                      <td key={m} className={`${cell} ${pctColor(c - p)}`}>
                        <div>{c - p >= 0 ? "+" : "−"}{money(Math.abs(c - p))}</div>
                        <div className="text-[11px]">{fmtPct(c, p)}</div>
                      </td>
                    );
                  })}
                  <td className={`${cell} ${pctColor(sum(byYear.get(cur)!.income) - sum(byYear.get(prev)!.income))}`}>
                    <div>{sum(byYear.get(cur)!.income) - sum(byYear.get(prev)!.income) >= 0 ? "+" : "−"}{money(Math.abs(sum(byYear.get(cur)!.income) - sum(byYear.get(prev)!.income)))}</div>
                    <div className="text-[11px]">{fmtPct(sum(byYear.get(cur)!.income), sum(byYear.get(prev)!.income))}</div>
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-300">
                    Events Δ<div className="text-[10px] font-normal text-zinc-400">{cur} vs {prev}</div>
                  </td>
                  {MONTHS.map((_, m) => {
                    const c = byYear.get(cur)!.count[m];
                    const p = byYear.get(prev)!.count[m];
                    return (
                      <td key={m} className={`${cell} ${pctColor(c - p)}`}>
                        <div>{c - p >= 0 ? "+" : "−"}{Math.abs(c - p)}</div>
                        <div className="text-[11px]">{fmtPct(c, p)}</div>
                      </td>
                    );
                  })}
                  <td className={`${cell} ${pctColor(sum(byYear.get(cur)!.count) - sum(byYear.get(prev)!.count))}`}>
                    <div>{sum(byYear.get(cur)!.count) - sum(byYear.get(prev)!.count) >= 0 ? "+" : "−"}{Math.abs(sum(byYear.get(cur)!.count) - sum(byYear.get(prev)!.count))}</div>
                    <div className="text-[11px]">{fmtPct(sum(byYear.get(cur)!.count), sum(byYear.get(prev)!.count))}</div>
                  </td>
                </tr>
              </>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-zinc-800 font-bold text-white dark:bg-black/40">
              <td className="px-3 py-2">Total</td>
              {MONTHS.map((_, m) => (
                <td key={m} className="border-l border-white/10 px-2 py-2 text-right">
                  <div>{money(monthIncomeTotal[m])}</div>
                  <div className="text-[11px] opacity-70">{monthCountTotal[m]}</div>
                </td>
              ))}
              <td className="border-l border-white/10 px-2 py-2 text-right">
                <div>{money(sum(monthIncomeTotal))}</div>
                <div className="text-[11px] opacity-70">{sum(monthCountTotal)}</div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {years.length === 0 && <p className="mt-4 text-sm text-zinc-500">No events with financial-counting statuses yet.</p>}
    </div>
  );
}
