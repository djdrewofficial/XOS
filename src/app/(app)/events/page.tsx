import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money, eventTotal, type XEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; view?: string }>;
}) {
  const { status, view } = await searchParams;
  const supabase = await createClient();

  const { data: statuses } = await supabase
    .from("event_statuses")
    .select("*")
    .order("sort_order");

  let q = supabase
    .from("events")
    .select(
      "*, client:clients(*), status:event_statuses(*), venue:venues(*), package:packages(*), event_type:event_types(*), salesperson:employees(*)"
    )
    .order("event_date", { ascending: true });

  const today = new Date().toISOString().slice(0, 10);
  if (view === "past") q = q.lt("event_date", today);
  else if (view !== "all") q = q.gte("event_date", today);

  if (status) q = q.eq("status_id", status);

  const { data: events } = await q.limit(300);

  // payments per event for balance due
  const ids = (events ?? []).map((e) => e.id);
  const { data: pays } = ids.length
    ? await supabase.from("payments").select("event_id, amount").in("event_id", ids)
    : { data: [] as { event_id: string; amount: number }[] };
  const paidByEvent = new Map<string, number>();
  (pays ?? []).forEach((p) => {
    if (p.event_id)
      paidByEvent.set(p.event_id, (paidByEvent.get(p.event_id) ?? 0) + Number(p.amount));
  });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Events List</h1>
        <Link
          href="/events/new"
          className="btn-primary px-4 py-2"
        >
          Add Event
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {[
          { label: "Upcoming", href: "/events" },
          { label: "Past", href: "/events?view=past" },
          { label: "All", href: "/events?view=all" },
        ].map((f) => (
          <Link
            key={f.label}
            href={f.href}
            className="btn-ghost rounded-full px-3 py-1"
          >
            {f.label}
          </Link>
        ))}
        <span className="mx-2 text-zinc-300">|</span>
        {(statuses ?? []).filter((s) => s.is_active).map((s) => (
          <Link
            key={s.id}
            href={`/events?view=all&status=${s.id}`}
            className="rounded-full px-3 py-1 text-xs font-semibold hover:ring-2 hover:ring-brand-light"
            style={{ backgroundColor: s.color, color: s.text_color }}
          >
            {s.name}
          </Link>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Event Date</th>
              <th className="px-4 py-2">Event Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Cell</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Package</th>
              <th className="px-4 py-2 text-right">Balance Due</th>
              <th className="px-4 py-2 text-right">Total Fee</th>
              <th className="px-4 py-2">Venue</th>
            </tr>
          </thead>
          <tbody>
            {(events ?? []).map((e: XEvent) => {
              const total = eventTotal(e);
              const balance = total - (paidByEvent.get(e.id) ?? 0);
              return (
                <tr
                  key={e.id}
                  className="row"
                  style={{ backgroundColor: e.status ? `${e.status.color}40` : undefined }}
                >
                  <td className="px-4 py-2 whitespace-nowrap">{e.event_date ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Link href={`/events/${e.id}`} className="font-medium text-brand-lighter hover:underline">
                      {e.name || "(unnamed)"}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{e.event_type?.name ?? "—"}</td>
                  <td className="px-4 py-2">
                    {e.client ? `${e.client.first_name} ${e.client.last_name}` : "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{e.client?.cell_phone ?? ""}</td>
                  <td className="px-4 py-2 whitespace-nowrap font-semibold">{e.status?.name}</td>
                  <td className="px-4 py-2">{e.package?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{money(balance)}</td>
                  <td className="px-4 py-2 text-right">{money(total)}</td>
                  <td className="px-4 py-2">{e.venue?.name ?? "—"}</td>
                </tr>
              );
            })}
            {(events ?? []).length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-zinc-400">
                  No events match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
