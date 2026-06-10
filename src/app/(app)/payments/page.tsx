import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;
  const y = parseInt(year ?? "") || new Date().getFullYear();
  const supabase = await createClient();

  const { data: payments } = await supabase
    .from("payments")
    .select("*, event:events(id, name, event_date)")
    .gte("paid_at", `${y}-01-01T00:00:00`)
    .lte("paid_at", `${y}-12-31T23:59:59`)
    .order("paid_at", { ascending: false });

  // monthly summary
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i,
    label: new Date(y, i, 1).toLocaleString("en-US", { month: "long" }),
    total: 0,
    count: 0,
  }));
  (payments ?? []).forEach((p) => {
    const m = new Date(p.paid_at).getMonth();
    months[m].total += Number(p.amount);
    months[m].count += 1;
  });
  const yearTotal = months.reduce((s, m) => s + m.total, 0);

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Payments — {y}</h1>
        <div className="flex gap-2 text-sm">
          <Link href={`/payments?year=${y - 1}`} className="btn-ghost px-3 py-1">← {y - 1}</Link>
          <Link href={`/payments?year=${y + 1}`} className="btn-ghost px-3 py-1">{y + 1} →</Link>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3 md:grid-cols-6">
        {months.map((m) => (
          <div key={m.month} className="card p-3 text-center">
            <div className="text-xs uppercase text-zinc-400">{m.label.slice(0, 3)}</div>
            <div className="text-sm font-bold">{money(m.total)}</div>
            <div className="text-[10px] text-zinc-400">{m.count} payments</div>
          </div>
        ))}
      </div>
      <div className="mb-6 rounded-lg bg-green-700 p-4 text-white shadow">
        <span className="text-sm uppercase tracking-wide opacity-80">Total {y} Payments Received</span>
        <div className="text-3xl font-black">{money(yearTotal)}</div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Paid</th>
              <th className="px-4 py-2">Event</th>
              <th className="px-4 py-2">Method</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(payments ?? []).map((p) => (
              <tr key={p.id} className="row">
                <td className="px-4 py-2">{new Date(p.paid_at).toLocaleDateString()}</td>
                <td className="px-4 py-2">
                  {p.event ? (
                    <Link href={`/events/${(p.event as { id: string }).id}`} className="text-violet-300 hover:underline">
                      {(p.event as { name: string }).name || "(unnamed)"}
                    </Link>
                  ) : (
                    <span className="text-zinc-400">Unassigned</span>
                  )}
                </td>
                <td className="px-4 py-2">{p.method}</td>
                <td className="px-4 py-2">{p.status}</td>
                <td className="px-4 py-2 text-right font-semibold text-emerald-400">{money(p.amount)}</td>
              </tr>
            ))}
            {(payments ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">No payments in {y}.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
