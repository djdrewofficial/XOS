import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";

export const dynamic = "force-dynamic";

/* Reports → Leads & Sales (admins only). Booking moment = contract_signed_date
   (fallback booked_date); lead moment = initial_contact_date (fallback created). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Ev = {
  event_date: string | null;
  initial_contact_date: string | null;
  contract_signed_date: string | null;
  booked_date: string | null;
  created_at: string;
  event_type_id: string | null;
  status_id: string | null;
  inquiry_source_id: string | null;
  event_type: { name: string } | null;
  status: { name: string; is_booked_group: boolean } | null;
  inquiry_source: { name: string } | null;
};

const yearOf = (iso: string | null) => (iso ? Number(iso.slice(0, 4)) : null);
const monthOf = (iso: string) => Number(iso.slice(5, 7)) - 1;
const daysBetween = (a: string, b: string) => (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000;
const leadDate = (e: Ev) => e.initial_contact_date ?? (e.created_at ? e.created_at.slice(0, 10) : null);
const bookedDate = (e: Ev) => e.contract_signed_date ?? e.booked_date ?? null;
const isBooked = (e: Ev) => !!e.status?.is_booked_group;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0);
const mo = (days: number) => `${(days / 30.44).toFixed(1)} mo`;

export default async function LeadsReportPage({ searchParams }: { searchParams: Promise<{ year?: string; type?: string; status?: string }> }) {
  const supabase = await createClient();

  await requireModule("reports", "view", { supabase });

  const sp = await searchParams;
  const y = parseInt(sp.year ?? "") || new Date().getFullYear();
  const typeFilter = sp.type && sp.type !== "all" ? sp.type : null;
  const statusFilter = sp.status && sp.status !== "all" ? sp.status : null;

  const [{ data: rawEvents }, { data: types }, { data: statuses }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "event_date, initial_contact_date, contract_signed_date, booked_date, created_at, event_type_id, status_id, inquiry_source_id, " +
          "event_type:event_types(name), status:event_statuses(name, is_booked_group), inquiry_source:inquiry_sources(name)"
      )
      .limit(10000),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("event_statuses").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  const all = (rawEvents ?? []) as unknown as Ev[];
  const evs = all.filter((e) => (!typeFilter || e.event_type_id === typeFilter) && (!statusFilter || e.status_id === statusFilter));

  // ---- leads per month, all years (multi-year trend) ----
  const byYear = new Map<number, number[]>();
  for (const e of evs) {
    const ld = leadDate(e);
    if (!ld) continue;
    const yr = yearOf(ld)!;
    if (!byYear.has(yr)) byYear.set(yr, Array(12).fill(0));
    byYear.get(yr)![monthOf(ld)] += 1;
  }
  const gridYears = [...byYear.keys()].sort((a, b) => a - b);
  const yearOptions = [...new Set([...gridYears, new Date().getFullYear(), y])].sort((a, b) => b - a);

  // ---- selected-year metrics ----
  const leadsThisYear = evs.filter((e) => yearOf(leadDate(e)) === y);
  const bookedThisYear = evs.filter((e) => isBooked(e) && yearOf(bookedDate(e)) === y);
  const conversion = leadsThisYear.length ? (bookedThisYear.length / leadsThisYear.length) * 100 : 0;
  const leadTimeDays = bookedThisYear.filter((e) => e.event_date && bookedDate(e)).map((e) => daysBetween(bookedDate(e)!, e.event_date!));
  const timeToBookDays = bookedThisYear.filter((e) => bookedDate(e) && leadDate(e)).map((e) => daysBetween(leadDate(e)!, bookedDate(e)!));

  // ---- inquiry sources (leads in year) ----
  const srcMap = new Map<string, { leads: number; booked: number }>();
  for (const e of leadsThisYear) {
    const name = e.inquiry_source?.name ?? "— none —";
    if (!srcMap.has(name)) srcMap.set(name, { leads: 0, booked: 0 });
    const s = srcMap.get(name)!;
    s.leads += 1;
    if (isBooked(e)) s.booked += 1;
  }
  const sources = [...srcMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.leads - a.leads);

  // ---- lead time by event type (booked in year) ----
  const typeMap = new Map<string, { count: number; lead: number[]; ttb: number[] }>();
  for (const e of bookedThisYear) {
    const name = e.event_type?.name ?? "— none —";
    if (!typeMap.has(name)) typeMap.set(name, { count: 0, lead: [], ttb: [] });
    const t = typeMap.get(name)!;
    t.count += 1;
    if (e.event_date && bookedDate(e)) t.lead.push(daysBetween(bookedDate(e)!, e.event_date!));
    if (bookedDate(e) && leadDate(e)) t.ttb.push(daysBetween(leadDate(e)!, bookedDate(e)!));
  }
  const typeRows = [...typeMap.entries()].map(([name, v]) => ({ name, count: v.count, lead: avg(v.lead), ttb: avg(v.ttb) })).sort((a, b) => b.count - a.count);

  const cell = "border-l border-zinc-100 px-2 py-1.5 text-right dark:border-white/[0.06]";
  const sel = "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900";

  return (
    <div className="max-w-[1700px] space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leads &amp; Sales — {y}</h1>
        <a href={`/api/reports/leads?year=${y}&type=${typeFilter ?? "all"}&status=${statusFilter ?? "all"}`} target="_blank" rel="noopener" className="btn-ghost px-3 py-1.5 text-sm">🖨 Export PDF</a>
      </div>

      {/* filters */}
      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-xs">Year</label>
          <select name="year" defaultValue={String(y)} className={sel}>
            {yearOptions.map((yr) => (<option key={yr} value={yr}>{yr}</option>))}
          </select>
        </div>
        <div>
          <label className="label-xs">Event type</label>
          <select name="type" defaultValue={typeFilter ?? "all"} className={sel}>
            <option value="all">All types</option>
            {(types ?? []).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
        </div>
        <div>
          <label className="label-xs">Status</label>
          <select name="status" defaultValue={statusFilter ?? "all"} className={sel}>
            <option value="all">All statuses</option>
            {(statuses ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        </div>
        <button className="btn-primary px-4 py-2 text-sm">Apply</button>
      </form>

      {/* headline cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Leads", value: String(leadsThisYear.length) },
          { label: "Booked", value: String(bookedThisYear.length) },
          { label: "Conversion", value: `${conversion.toFixed(0)}%` },
          { label: "Avg lead time", value: leadTimeDays.length ? mo(avg(leadTimeDays)) : "—" },
          { label: "Avg time to book", value: timeToBookDays.length ? `${Math.round(avg(timeToBookDays))}d` : "—" },
        ].map((c) => (
          <div key={c.label} className="card p-4 text-center">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">{c.label}</div>
            <div className="text-2xl font-black text-zinc-900 dark:text-white">{c.value}</div>
          </div>
        ))}
      </div>

      {/* leads per month — multi-year */}
      <div>
        <h2 className="card-title">Leads per Month</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-zinc-500">Year</th>
                {MONTHS.map((m) => (<th key={m} className="border-l border-zinc-200 px-2 py-2 text-right text-[11px] font-bold uppercase text-zinc-500 dark:border-white/[0.08]">{m}</th>))}
                <th className="border-l border-zinc-200 px-2 py-2 text-right text-[11px] font-bold uppercase text-zinc-500 dark:border-white/[0.08]">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {gridYears.map((yr) => {
                const arr = byYear.get(yr)!;
                return (
                  <tr key={yr} className={yr === y ? "bg-brand/5" : ""}>
                    <td className="bg-zinc-100 px-3 py-1.5 font-bold dark:bg-white/[0.05]">{yr}</td>
                    {arr.map((n, i) => (<td key={i} className={cell}>{n || ""}</td>))}
                    <td className={`${cell} font-semibold`}>{arr.reduce((s, n) => s + n, 0)}</td>
                  </tr>
                );
              })}
              {gridYears.length === 0 && (<tr><td colSpan={14} className="px-3 py-6 text-center text-zinc-500">No leads yet.</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* inquiry sources */}
        <div>
          <h2 className="card-title">Inquiry Sources — {y}</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="table-head"><tr><th className="px-3 py-2 text-left">Source</th><th className="px-3 py-2 text-right">Leads</th><th className="px-3 py-2 text-right">Booked</th><th className="px-3 py-2 text-right">Conv.</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
                {sources.map((s) => (
                  <tr key={s.name}><td className="px-3 py-2">{s.name}</td><td className="px-3 py-2 text-right">{s.leads}</td><td className="px-3 py-2 text-right">{s.booked}</td><td className="px-3 py-2 text-right">{s.leads ? `${Math.round((s.booked / s.leads) * 100)}%` : "—"}</td></tr>
                ))}
                {sources.length === 0 && (<tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-500">No leads in {y}.</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>

        {/* lead time by event type */}
        <div>
          <h2 className="card-title">Booking Lead Time by Type — {y}</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="table-head"><tr><th className="px-3 py-2 text-left">Event Type</th><th className="px-3 py-2 text-right">Booked</th><th className="px-3 py-2 text-right">Avg Lead Time</th><th className="px-3 py-2 text-right">Time to Book</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
                {typeRows.map((t) => (
                  <tr key={t.name}><td className="px-3 py-2">{t.name}</td><td className="px-3 py-2 text-right">{t.count}</td><td className="px-3 py-2 text-right">{t.lead ? mo(t.lead) : "—"}</td><td className="px-3 py-2 text-right">{t.ttb ? `${Math.round(t.ttb)}d` : "—"}</td></tr>
                ))}
                {typeRows.length === 0 && (<tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-500">No bookings in {y}.</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
