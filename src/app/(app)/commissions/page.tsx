import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money, eventTotal, type XEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

/* Sales & Commissions: per-salesperson booked sales and commission owed for a
   year. Sales commission = sales_commission_pct × booking base (excl. add-ons);
   add-on commission = addon_commission_pct × add-on revenue. Booked (Financials-
   counting) events only, by event date. */

type Agg = {
  id: string;
  name: string;
  salesPct: number;
  addonPct: number;
  events: number;
  saleBase: number; // package/fees − discounts + venue setup (excludes add-ons)
  addonRev: number;
};

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year } = await searchParams;
  const y = parseInt(year ?? "") || new Date().getFullYear();
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, event_date, salesperson_id, archived_at, package_price_override, package_price_locked, overtime_fee, travel_fee, discount1_amount, discount2_amount, " +
        "status:event_statuses(counts_financial), package:packages(default_price), venue:venues(setup_fee), " +
        "event_addons(quantity, price_override, price_locked, addon:addons(default_price)), " +
        "salesperson:employees(id, first_name, last_name, sales_commission_pct, addon_commission_pct)"
    )
    .gte("event_date", `${y}-01-01`)
    .lte("event_date", `${y}-12-31`)
    .limit(5000);

  const byPerson = new Map<string, Agg>();
  for (const ev of (events ?? []) as unknown as Array<Record<string, unknown>>) {
    if (ev.archived_at) continue;
    if (!(ev.status as { counts_financial?: boolean } | null)?.counts_financial) continue;
    const sp = ev.salesperson as { id?: string; first_name?: string; last_name?: string; sales_commission_pct?: number; addon_commission_pct?: number } | null;
    const key = sp?.id ?? "unassigned";

    const addonRev = ((ev.event_addons ?? []) as Array<Record<string, unknown>>).reduce((s, a) => {
      const unit = (a.price_override as number) ?? (a.price_locked as number) ?? (a.addon as { default_price?: number } | null)?.default_price ?? 0;
      return s + Number(a.quantity) * Number(unit);
    }, 0);
    const venueSetup = Number((ev.venue as { setup_fee?: number } | null)?.setup_fee ?? 0);
    const saleBase = eventTotal(ev as unknown as XEvent) + venueSetup;

    if (!byPerson.has(key)) {
      byPerson.set(key, {
        id: key,
        name: sp ? `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim() || "—" : "Unassigned",
        salesPct: Number(sp?.sales_commission_pct ?? 0),
        addonPct: Number(sp?.addon_commission_pct ?? 0),
        events: 0,
        saleBase: 0,
        addonRev: 0,
      });
    }
    const agg = byPerson.get(key)!;
    agg.events += 1;
    agg.saleBase += saleBase;
    agg.addonRev += addonRev;
  }

  const people = [...byPerson.values()].sort((a, b) => b.saleBase + b.addonRev - (a.saleBase + a.addonRev));
  const salesComm = (a: Agg) => (a.saleBase * a.salesPct) / 100;
  const addonComm = (a: Agg) => (a.addonRev * a.addonPct) / 100;
  const totalComm = (a: Agg) => salesComm(a) + addonComm(a);

  const tot = people.reduce(
    (s, a) => ({ events: s.events + a.events, sales: s.sales + a.saleBase + a.addonRev, sComm: s.sComm + salesComm(a), aComm: s.aComm + addonComm(a) }),
    { events: 0, sales: 0, sComm: 0, aComm: 0 }
  );

  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sales &amp; Commissions — {y}</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/commissions?year=${y - 1}`} className="btn-ghost px-3 py-1">← {y - 1}</Link>
          <Link href={`/commissions?year=${y + 1}`} className="btn-ghost px-3 py-1">{y + 1} →</Link>
          <a href={`/api/reports/commissions?year=${y}`} target="_blank" rel="noopener" className="btn-ghost px-3 py-1.5 text-sm">🖨 Export PDF</a>
        </div>
      </div>
      <p className="mb-4 text-xs text-zinc-500">Booked (Financials-counting) events by event date. Set rates per person on the employee&apos;s profile.</p>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-3 py-2 text-left">Salesperson</th>
              <th className="px-3 py-2 text-right">Events</th>
              <th className="px-3 py-2 text-right">Sales</th>
              <th className="px-3 py-2 text-right">Sales Rate</th>
              <th className="px-3 py-2 text-right">Sales Comm.</th>
              <th className="px-3 py-2 text-right">Add-on Comm.</th>
              <th className="px-3 py-2 text-right">Total Comm.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {people.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 font-medium">{a.name}</td>
                <td className="px-3 py-2 text-right">{a.events}</td>
                <td className="px-3 py-2 text-right">{money(a.saleBase + a.addonRev)}</td>
                <td className="px-3 py-2 text-right text-zinc-500">{a.salesPct}%{a.addonPct ? ` · ${a.addonPct}% add-on` : ""}</td>
                <td className="px-3 py-2 text-right">{money(salesComm(a))}</td>
                <td className="px-3 py-2 text-right">{money(addonComm(a))}</td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{money(totalComm(a))}</td>
              </tr>
            ))}
            {people.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-zinc-500">No booked sales in {y}.</td></tr>
            )}
          </tbody>
          {people.length > 0 && (
            <tfoot>
              <tr className="bg-zinc-100 font-bold dark:bg-white/[0.06]">
                <td className="px-3 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right">{tot.events}</td>
                <td className="px-3 py-2.5 text-right">{money(tot.sales)}</td>
                <td className="px-3 py-2.5 text-right text-zinc-400">—</td>
                <td className="px-3 py-2.5 text-right">{money(tot.sComm)}</td>
                <td className="px-3 py-2.5 text-right">{money(tot.aComm)}</td>
                <td className="px-3 py-2.5 text-right text-emerald-700 dark:text-emerald-300">{money(tot.sComm + tot.aComm)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
