import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money, type XEvent } from "@/lib/types";
import { holidaysForYear } from "@/lib/holidays";
import EventChip from "@/components/EventChip";

export const dynamic = "force-dynamic";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const supabase = await createClient();

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // viewed month
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-11
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    year = parseInt(m.slice(0, 4));
    month = parseInt(m.slice(5, 7)) - 1;
  }

  const monthStart = `${year}-${pad(month + 1)}-01`;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`;

  // calendar grid range (Sunday before the 1st → Saturday after the last)
  const firstDow = new Date(year, month, 1).getDay();
  const gridStart = new Date(year, month, 1 - firstDow);
  const cells: { date: string; inMonth: boolean; dayNum: number }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      inMonth: d.getMonth() === month,
      dayNum: d.getDate(),
    });
  }
  const gridStartStr = cells[0].date;
  const gridEndStr = cells[41].date;

  // stats for the CURRENT real month (not the viewed one)
  const realMonthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const realMonthEnd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  )}`;

  const [{ data: statuses }, { data: monthEvents }, { data: createdThisMonth }, { data: timeOff }, { data: recentPayments }] =
    await Promise.all([
      supabase.from("event_statuses").select("*"),
      supabase
        .from("events")
        .select("id, name, event_date, status_id, client:clients(first_name, last_name), status:event_statuses(name, color, text_color)")
        .gte("event_date", gridStartStr)
        .lte("event_date", gridEndStr)
        .order("event_date"),
      supabase
        .from("events")
        .select("id, status_id, created_at")
        .gte("created_at", `${realMonthStart}T00:00:00`)
        .lte("created_at", `${realMonthEnd}T23:59:59`),
      supabase
        .from("employee_time_off")
        .select("*, employee:employees(first_name, last_name)")
        .eq("status", "approved")
        .lte("start_date", gridEndStr)
        .gte("end_date", gridStartStr),
      supabase.from("payments").select("*, event:events(id, name)").order("paid_at", { ascending: false }).limit(6),
    ]);

  const leadIds = new Set((statuses ?? []).filter((s) => s.is_leads_group).map((s) => s.id));
  const lostIds = new Set((statuses ?? []).filter((s) => s.is_lost_sale_group).map((s) => s.id));
  const bookedIds = new Set((statuses ?? []).filter((s) => s.is_booked_group).map((s) => s.id));

  const leads = (createdThisMonth ?? []).filter((e) => e.status_id && leadIds.has(e.status_id)).length;
  const lost = (createdThisMonth ?? []).filter((e) => e.status_id && lostIds.has(e.status_id)).length;
  const booked = (createdThisMonth ?? []).filter((e) => e.status_id && bookedIds.has(e.status_id)).length;
  const inquiries = (createdThisMonth ?? []).length;

  // index events / time off / holidays by date
  const eventsByDate = new Map<string, typeof monthEvents>();
  (monthEvents ?? []).forEach((e) => {
    if (!e.event_date) return;
    if (!eventsByDate.has(e.event_date)) eventsByDate.set(e.event_date, []);
    eventsByDate.get(e.event_date)!.push(e);
  });

  const holidays = new Map<string, string>([
    ...holidaysForYear(year - 1),
    ...holidaysForYear(year),
    ...holidaysForYear(year + 1),
  ]);

  function timeOffOn(date: string) {
    return (timeOff ?? []).filter((t) => t.start_date <= date && t.end_date >= date);
  }

  const monthLabel = new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const prev = month === 0 ? `${year - 1}-12` : `${year}-${pad(month)}`;
  const next = month === 11 ? `${year + 1}-01` : `${year}-${pad(month + 2)}`;

  const cards = [
    { label: "Leads This Month", value: leads, glow: "from-blue-500/25", accent: "text-blue-300" },
    { label: "Lost Sales This Month", value: lost, glow: "from-red-500/25", accent: "text-red-300" },
    { label: "Booked This Month", value: booked, glow: "from-emerald-500/25", accent: "text-emerald-300" },
    { label: "Inquiries This Month", value: inquiries, glow: "from-violet-500/25", accent: "text-violet-300" },
  ];

  return (
    <div>
      <h1 className="page-title mb-5">Dashboard</h1>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`card bg-gradient-to-br ${c.glow} to-transparent p-4`}>
            <div className={`text-3xl font-black ${c.accent}`}>{c.value}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{c.label}</div>
          </div>
        ))}
      </div>

      {/* ---------- CALENDAR ---------- */}
      <div className="card mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Link href={`/?m=${prev}`} className="btn-ghost px-3 py-1.5 text-xs">←</Link>
            <Link href={`/?m=${next}`} className="btn-ghost px-3 py-1.5 text-xs">→</Link>
            <Link href="/" className="btn-ghost px-3 py-1.5 text-xs">today</Link>
          </div>
          <h2 className="text-lg font-bold text-white">{monthLabel}</h2>
          <div className="text-xs text-zinc-500">
            {(monthEvents ?? []).filter((e) => e.event_date && e.event_date >= monthStart && e.event_date <= monthEnd).length}{" "}
            events this month
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-white/[0.06] bg-white/[0.03]">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell, i) => {
            const dayEvents = eventsByDate.get(cell.date) ?? [];
            const off = timeOffOn(cell.date);
            const holiday = holidays.get(cell.date);
            const isToday = cell.date === todayStr;
            return (
              <div
                key={cell.date}
                className={`min-h-28 border-white/[0.05] p-1 ${i % 7 !== 0 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${
                  cell.inMonth ? "" : "bg-black/30"
                } ${isToday ? "bg-violet-500/[0.12] ring-1 ring-inset ring-violet-400/50" : ""}`}
              >
                <div
                  className={`mb-1 px-1 text-right text-xs font-semibold ${
                    isToday ? "text-violet-300" : cell.inMonth ? "text-zinc-400" : "text-zinc-700"
                  }`}
                >
                  {cell.dayNum}
                </div>
                <div className="space-y-0.5">
                  {holiday && (
                    <div className="truncate rounded bg-sky-700/70 px-1.5 py-0.5 text-[10px] font-semibold text-sky-100">
                      {holiday}
                    </div>
                  )}
                  {dayEvents.map((e) => {
                    const st = e.status as unknown as { name: string; color: string; text_color: string } | null;
                    const client = e.client as unknown as { first_name: string; last_name: string } | null;
                    const label = `${st?.name ?? ""} - ${client ? `${client.first_name} ${client.last_name}` : e.name || "Event"}`;
                    return (
                      <EventChip
                        key={e.id}
                        eventId={e.id}
                        label={label}
                        bg={st?.color ?? "#97CC9A"}
                        fg={st?.text_color ?? "#000"}
                      />
                    );
                  })}
                  {off.map((t) => {
                    const emp = t.employee as unknown as { first_name: string; last_name: string } | null;
                    return (
                      <div
                        key={t.id}
                        className="truncate rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300"
                        title={`Time off: ${emp?.first_name} ${emp?.last_name}`}
                      >
                        Time Off - {emp?.first_name ?? "?"}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------- below the calendar ---------- */}
      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="card-title">Upcoming Events</h2>
          <div className="card overflow-hidden">
            <UpcomingList supabasePromise={null} />
          </div>
        </div>
        <div>
          <h2 className="card-title">Recent Payments</h2>
          <div className="card p-4">
            {(recentPayments ?? []).length === 0 && (
              <p className="py-3 text-center text-sm text-zinc-500">No payments recorded.</p>
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

async function UpcomingList({}: { supabasePromise: null }) {
  const supabase = await createClient();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const { data: upcoming } = await supabase
    .from("events")
    .select("*, client:clients(first_name, last_name), status:event_statuses(name, color, text_color), venue:venues(name)")
    .gte("event_date", todayStr)
    .order("event_date", { ascending: true })
    .limit(8);

  return (
    <table className="w-full text-sm">
      <thead className="table-head">
        <tr>
          <th className="px-4 py-2">Date</th>
          <th className="px-4 py-2">Event</th>
          <th className="px-4 py-2">Status</th>
          <th className="px-4 py-2">Venue</th>
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
              {e.status && (
                <span className="chip" style={{ backgroundColor: e.status.color, color: e.status.text_color }}>
                  {e.status.name}
                </span>
              )}
            </td>
            <td className="px-4 py-2">{e.venue?.name ?? "—"}</td>
          </tr>
        ))}
        {(upcoming ?? []).length === 0 && (
          <tr>
            <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
              No upcoming events.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
