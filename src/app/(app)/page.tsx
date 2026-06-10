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
    { label: "Leads This Month", value: leads, bg: "bg-blue-900" },
    { label: "Lost Sales This Month", value: lost, bg: "bg-red-700" },
    { label: "Booked This Month", value: booked, bg: "bg-green-700" },
    { label: "Inquiries This Month", value: inquiries ?? 0, bg: "bg-zinc-700" },
  ];

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold">Dashboard</h1>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-lg ${c.bg} p-5 text-white shadow`}>
            <div className="text-4xl font-black">{c.value}</div>
            <div className="mt-1 text-sm opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Upcoming Events</h2>
          <div className="overflow-hidden rounded-lg bg-white shadow">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
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
                  <tr key={e.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                    <td className="px-4 py-2 whitespace-nowrap">{e.event_date}</td>
                    <td className="px-4 py-2">
                      <Link href={`/events/${e.id}`} className="font-medium text-violet-700 hover:underline">
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
          <div className="rounded-lg bg-white p-4 shadow">
            {(recentPayments ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-400">No payments recorded.</p>
            )}
            <ul className="divide-y divide-zinc-100">
              {(recentPayments ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-zinc-600">
                    {new Date(p.paid_at).toLocaleDateString()} ·{" "}
                    {(p.event as { name?: string } | null)?.name ?? "Unassigned"}
                  </span>
                  <span className="font-semibold text-green-700">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
