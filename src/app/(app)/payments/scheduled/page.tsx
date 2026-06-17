import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";

export const dynamic = "force-dynamic";

type SchedRow = {
  id: string;
  due_date: string | null;
  amount: number;
  label: string | null;
  event: {
    id: string;
    name: string | null;
    event_date: string | null;
    archived_at: string | null;
    client: { first_name: string; last_name: string } | null;
    status: { name: string; color: string; text_color: string; counts_financial: boolean } | null;
  } | null;
};

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function ScheduledPaymentsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year } = await searchParams;
  const y = parseInt(year ?? "") || new Date().getFullYear();
  const supabase = await createClient();

  const { data } = await supabase
    .from("scheduled_payments")
    .select(
      "id, due_date, amount, label, event:events(id, name, event_date, archived_at, client:clients(first_name, last_name), status:event_statuses(name, color, text_color, counts_financial))"
    )
    .gte("due_date", `${y}-01-01`)
    .lte("due_date", `${y}-12-31`)
    .order("due_date");

  // projected income only counts statuses flagged "Counts toward Financials"
  // (an event that isn't locked in yet shouldn't inflate expected income)
  const rows = ((data ?? []) as unknown as SchedRow[]).filter(
    (r) => r.due_date && !r.event?.archived_at && r.event?.status?.counts_financial
  );

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i,
    label: new Date(y, i, 1).toLocaleString("en-US", { month: "long" }),
    rows: [] as SchedRow[],
    total: 0,
  }));
  for (const r of rows) {
    const m = new Date(`${r.due_date}T00:00:00`).getMonth();
    months[m].rows.push(r);
    months[m].total += Number(r.amount);
  }
  const yearTotal = rows.reduce((s, r) => s + Number(r.amount), 0);
  const yearCount = rows.length;

  const cols = "grid grid-cols-[1.4fr_0.8fr_1fr] gap-3";

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Scheduled Payments — {y}</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/payments/scheduled?year=${y - 1}`} className="btn-ghost px-3 py-1">← {y - 1}</Link>
          <Link href={`/payments/scheduled?year=${y + 1}`} className="btn-ghost px-3 py-1">{y + 1} →</Link>
          <a href={`/api/reports/scheduled?year=${y}`} target="_blank" rel="noopener" className="btn-ghost px-3 py-1.5 text-sm">🖨 Export PDF</a>
        </div>
      </div>

      <div className="mb-6 rounded-lg bg-green-700 p-4 text-white shadow">
        <span className="text-sm uppercase tracking-wide opacity-80">Total {y} Scheduled</span>
        <div className="text-3xl font-black">{money(yearTotal)}</div>
        <div className="text-xs opacity-80">{yearCount} scheduled payments</div>
      </div>
      <p className="mb-4 -mt-3 text-xs text-zinc-500">Includes only statuses set to count toward Financials (Settings → Event Statuses).</p>

      <div className="card overflow-hidden">
        <div className={`${cols} border-b border-zinc-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-white/[0.08]`}>
          <span>Month</span>
          <span className="text-right"># Payments</span>
          <span className="text-right">Scheduled Amount</span>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
          {months.map((m) =>
            m.rows.length === 0 ? (
              <div key={m.month} className={`${cols} px-4 py-2.5 text-sm text-zinc-400`}>
                <span>{m.label}</span>
                <span className="text-right">0</span>
                <span className="text-right">{money(0)}</span>
              </div>
            ) : (
              <details key={m.month} className="group">
                <summary className={`${cols} cursor-pointer list-none items-center px-4 py-2.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden`}>
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="text-zinc-400 transition-transform group-open:rotate-90">›</span>
                    {m.label}
                  </span>
                  <span className="text-right">{m.rows.length}</span>
                  <span className="text-right font-semibold">{money(m.total)}</span>
                </summary>

                <div className="hidden bg-black/[0.02] px-4 py-2 group-open:block dark:bg-white/[0.03]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                        <th className="py-1.5 pr-3">Due</th>
                        <th className="py-1.5 pr-3">Title</th>
                        <th className="py-1.5 pr-3">Event</th>
                        <th className="py-1.5 pr-3">Client</th>
                        <th className="py-1.5 pr-3">Status</th>
                        <th className="py-1.5 pr-3 text-right">Amount</th>
                        <th className="py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
                      {m.rows.map((r) => {
                        const c = r.event?.client;
                        return (
                          <tr key={r.id}>
                            <td className="py-1.5 pr-3 whitespace-nowrap">{r.due_date ? fmt(r.due_date) : "—"}</td>
                            <td className="py-1.5 pr-3">{r.label || "Payment"}</td>
                            <td className="py-1.5 pr-3">{r.event?.name || "(unnamed)"}</td>
                            <td className="py-1.5 pr-3">{c ? `${c.first_name} ${c.last_name}`.trim() : "—"}</td>
                            <td className="py-1.5 pr-3">
                              {r.event?.status && (
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: r.event.status.color, color: r.event.status.text_color }}>
                                  {r.event.status.name}
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 text-right font-semibold">{money(r.amount)}</td>
                            <td className="py-1.5 text-right">
                              {r.event && (
                                <Link href={`/events/${r.event.id}`} className="text-xs font-semibold text-brand hover:underline dark:text-brand-lighter">
                                  View →
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )
          )}
        </div>
      </div>
    </div>
  );
}
