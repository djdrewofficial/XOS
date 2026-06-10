import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money, eventTotal, type XEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const supabase = await createClient();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const { data: statuses } = await supabase
    .from("event_statuses")
    .select("*");

  const leadIds = (statuses ?? []).filter((s) => s.is_leads_group).map((s) => s.id);
  const lostIds = (statuses ?? []).filter((s) => s.is_lost_sale_group).map((s) => s.id);
  const bookedIds = (statuses ?? []).filter((s) => s.is_booked_group).map((s) => s.id);

  async function countThisMonth(field: "created_at" | "event_date", ids: string[]) {
    if (ids.length === 0) return 0;
    let q = supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .in("status_id", ids);
    if (field === "created_at") {
      q = q.gte("created_at", `${monthStart}T00:00:00`).lte("created_at", `${monthEnd}T23:59:59`);
    } else {
      q = q.gte("event_date", monthStart).lte("event_date", monthEnd);
    }
    const { count } = await q;
    return count ?? 0;
  }

  const [leads, lost, booked] = await Promise.all([
    countThisMonth("created_at", leadIds),
    countThisMonth("created_at", lostIds),
    countThisMonth("created_at", bookedIds),
  ]);

  const { count: inquiries } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${monthStart}T00:00:00`)
    .lte("created_at", `${monthEnd}T23:59:59`);

  const { data: upcoming } = await supabase
    .from("events")
    .select(
      "*, client:clients(*), status:event_statuses(*), venue:venues(*), package:packages(*), event_type:event_types(*)"
    )
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(12);

  const { data: recentPayments } = await supabase
    .from("payments")
    .select("*, event:events(name)")
    .order("paid_at", { ascending: false })
    .limit(8);

  const cards = [
    { label: "Leads This Month", value: leads, glow: "from-blue-500/25", accent: "text-blue-300" },
    { label: "Lost Sales This Month", value: lost, glow: "from-red-500/25", accent: "text-red-300" },
    { label: "Booked This Month", value: booked, glow: "from-emerald-500/25", accent: "text-emerald-300" },
    { label: "Inquiries This Month", value: inquiries ?? 0, glow: "from-violet-500/25", accent: "text-violet-300" },
  ];

  return (
    <div>
      <h1 className="page-title mb-5">Dashboard</h1>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`card bg-gradient-to-br ${c.glow} to-transparent p-5`}
          >
            <div className={`text-4xl font-black ${c.accent}`}>{c.value}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Upcoming Events</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Event</th>
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Venue</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(upcoming ?? []).map((e: XEvent) => (
                  <tr key={e.id} className="row hover:bg-white/[0.04]">
                    <td className="px-4 py-2 whitespace-nowrap">{e.event_date}</td>
                    <td className="px-4 py-2">
                      <Link href={`/events/${e.id}`} className="font-medium text-violet-300 hover:underline">
                        {e.name || "(unnamed)"}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      {e.client ? `${e.client.first_name} ${e.client.last_name}` : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {e.status && (
                        <span
                          className="rounded px-2 py-0.5 text-xs font-semibold"
                          style={{ backgroundColor: e.status.color, color: e.status.text_color }}
                        >
                          {e.status.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">{e.venue?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{money(eventTotal(e))}</td>
                  </tr>
                ))}
                {(upcoming ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                      No upcoming events yet — add your first event.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Recent Payments</h2>
          <div className="card p-4">
            {(recentPayments ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-400">No payments recorded.</p>
            )}
            <ul className="divide-y divide-white/[0.06]">
              {(recentPayments ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-zinc-400">
                    {new Date(p.paid_at).toLocaleDateString()} ·{" "}
                    {(p.event as { name?: string } | null)?.name ?? "Unassigned"}
                  </span>
                  <span className="font-semibold text-emerald-400">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
