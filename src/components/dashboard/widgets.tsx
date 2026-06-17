import Link from "next/link";
import AddEventModal from "@/components/AddEventModal";
import { createClient } from "@/lib/supabase/server";
import { money, type XEvent } from "@/lib/types";
import { holidaysForYear } from "@/lib/holidays";
import EventChip from "@/components/EventChip";

/* Dashboard widgets — each is a self-contained async server component that
   fetches its own data. Registered in src/lib/dashboardWidgets.ts; placed
   per-role via Application → Dashboard Layout. */

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* ---------------- Monthly Stats ---------------- */
export async function StatCards() {
  const supabase = await createClient();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const monthEnd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  )}`;

  const [{ data: statuses }, { data: createdThisMonth }] = await Promise.all([
    supabase.from("event_statuses").select("id, is_leads_group, is_lost_sale_group, is_booked_group"),
    supabase
      .from("events")
      .select("id, status_id")
      .gte("created_at", `${monthStart}T00:00:00`)
      .lte("created_at", `${monthEnd}T23:59:59`),
  ]);

  const leadIds = new Set((statuses ?? []).filter((s) => s.is_leads_group).map((s) => s.id));
  const lostIds = new Set((statuses ?? []).filter((s) => s.is_lost_sale_group).map((s) => s.id));
  const bookedIds = new Set((statuses ?? []).filter((s) => s.is_booked_group).map((s) => s.id));

  const leads = (createdThisMonth ?? []).filter((e) => e.status_id && leadIds.has(e.status_id)).length;
  const lost = (createdThisMonth ?? []).filter((e) => e.status_id && lostIds.has(e.status_id)).length;
  const booked = (createdThisMonth ?? []).filter((e) => e.status_id && bookedIds.has(e.status_id)).length;

  const cards = [
    { label: "Leads This Month", value: leads, glow: "from-blue-500/25", accent: "text-blue-700 dark:text-blue-300" },
    { label: "Lost Sales This Month", value: lost, glow: "from-red-500/25", accent: "text-red-700 dark:text-red-300" },
    { label: "Booked This Month", value: booked, glow: "from-emerald-500/25", accent: "text-emerald-700 dark:text-emerald-300" },
    { label: "Inquiries This Month", value: (createdThisMonth ?? []).length, glow: "from-brand-light/25", accent: "text-brand dark:text-brand-lighter" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className={`card bg-gradient-to-br ${c.glow} to-transparent p-4`}>
          <div className={`text-3xl font-black ${c.accent}`}>{c.value}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Month Calendar ---------------- */
export async function MonthCalendar({ m }: { m?: string }) {
  const supabase = await createClient();
  const now = new Date();
  const today = todayStr();

  let year = now.getFullYear();
  let month = now.getMonth();
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    year = parseInt(m.slice(0, 4));
    month = parseInt(m.slice(5, 7)) - 1;
  }

  const monthStart = `${year}-${pad(month + 1)}-01`;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`;

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

  const [{ data: monthEvents }, { data: timeOff }] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, event_date, client:clients(first_name, last_name), status:event_statuses(name, color, text_color)")
      .is("archived_at", null)
      .gte("event_date", gridStartStr)
      .lte("event_date", gridEndStr)
      .order("event_date"),
    supabase
      .from("employee_time_off")
      .select("*, employee:employees(first_name, last_name)")
      .eq("status", "approved")
      .lte("start_date", gridEndStr)
      .gte("end_date", gridStartStr),
  ]);

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

  const timeOffOn = (date: string) =>
    (timeOff ?? []).filter((t) => t.start_date <= date && t.end_date >= date);

  const monthLabel = new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const prev = month === 0 ? `${year - 1}-12` : `${year}-${pad(month)}`;
  const next = month === 11 ? `${year + 1}-01` : `${year}-${pad(month + 2)}`;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Link href={`/?m=${prev}`} className="btn-ghost px-3 py-1.5 text-xs">←</Link>
          <Link href={`/?m=${next}`} className="btn-ghost px-3 py-1.5 text-xs">→</Link>
          <Link href="/" className="btn-ghost px-3 py-1.5 text-xs">today</Link>
        </div>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{monthLabel}</h2>
        <div className="text-xs text-zinc-500">
          {(monthEvents ?? []).filter((e) => e.event_date && e.event_date >= monthStart && e.event_date <= monthEnd).length}{" "}
          events this month
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-zinc-200 dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03]">
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
          const isToday = cell.date === today;
          return (
            <div
              key={cell.date}
              className={`min-h-28 border-zinc-100 dark:border-white/[0.05] p-1 ${i % 7 !== 0 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${
                cell.inMonth ? "" : "bg-zinc-100/80 dark:bg-black/30"
              } ${isToday ? "bg-brand/25 ring-1 ring-inset ring-brand-light/50" : ""}`}
            >
              <div
                className={`mb-1 px-1 text-right text-xs font-semibold ${
                  isToday ? "text-brand dark:text-brand-lighter" : cell.inMonth ? "text-zinc-600 dark:text-zinc-400" : "text-zinc-400 dark:text-zinc-700"
                }`}
              >
                {cell.dayNum}
              </div>
              <div className="space-y-0.5">
                {holiday && (
                  <div className="truncate rounded bg-sky-700/70 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:text-sky-100">
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
                      className="truncate rounded bg-zinc-300 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 dark:text-zinc-300"
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
  );
}

/* ---------------- Upcoming Events ---------------- */
export async function UpcomingEvents() {
  const supabase = await createClient();
  const { data: upcoming } = await supabase
    .from("events")
    .select("*, client:clients(first_name, last_name), status:event_statuses(name, color, text_color), venue:venues(name)")
    .is("archived_at", null)
    .gte("event_date", todayStr())
    .order("event_date", { ascending: true })
    .limit(8);

  return (
    <div>
      <h2 className="card-title">Upcoming Events</h2>
      <div className="card overflow-hidden">
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
              <tr key={e.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className="px-4 py-2 whitespace-nowrap">{e.event_date}</td>
                <td className="px-4 py-2">
                  <Link href={`/events/${e.id}`} className="font-medium text-brand dark:text-brand-lighter hover:underline">
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
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No upcoming events.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Recent Payments ---------------- */
export async function RecentPayments() {
  const supabase = await createClient();
  const { data: recentPayments } = await supabase
    .from("payments")
    .select("*, event:events(id, name)")
    .eq("status", "approved")
    .order("paid_at", { ascending: false })
    .limit(6);

  return (
    <div>
      <h2 className="card-title">Recent Payments</h2>
      <div className="card p-4">
        {(recentPayments ?? []).length === 0 && (
          <p className="py-3 text-center text-sm text-zinc-500">No payments recorded.</p>
        )}
        <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
          {(recentPayments ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                {new Date(p.paid_at).toLocaleDateString()} ·{" "}
                {(p.event as { name?: string } | null)?.name ?? "Unassigned"}
              </span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{money(p.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- Notifications ---------------- */
export async function RecentNotifications() {
  const supabase = await createClient();
  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(6);

  return (
    <div>
      <h2 className="card-title">Notifications</h2>
      <div className="card p-4">
        {(notifications ?? []).length === 0 && (
          <p className="py-3 text-center text-sm text-zinc-500">You&apos;re all caught up.</p>
        )}
        <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
          {(notifications ?? []).map((n) => (
            <li key={n.id} className="py-2 text-sm">
              <Link href={n.href ?? "/"} className={`block ${n.read_at ? "opacity-60" : ""}`}>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{n.title}</span>
                {n.body && <span className="block truncate text-xs text-zinc-500">{n.body}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- Quick Actions ---------------- */
export function QuickActions() {
  const actions = [
    { href: "/events", label: "Events List" },
    { href: "/clients", label: "Clients" },
    { href: "/payments", label: "Payments" },
    { href: "/venues", label: "Venues" },
    { href: "/packages", label: "Packages" },
  ];
  return (
    <div>
      <h2 className="card-title">Quick Actions</h2>
      <div className="card grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
        <AddEventModal className="btn-ghost justify-center py-3 text-sm">+ Add Event</AddEventModal>
        {actions.map((a) => (
          <Link key={a.href} href={a.href} className="btn-ghost justify-center py-3 text-sm">
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ---------------- My Upcoming Events (assigned to signed-in employee) ---------------- */
export async function MyUpcomingEvents() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: me } = auth?.user
    ? await supabase.from("employees").select("id").eq("auth_user_id", auth.user.id).maybeSingle()
    : { data: null };

  if (!me) {
    return (
      <div>
        <h2 className="card-title">My Upcoming Events</h2>
        <div className="card p-6 text-center text-sm text-zinc-500">
          Your login isn&apos;t linked to an employee profile yet.
        </div>
      </div>
    );
  }

  const { data: assignments } = await supabase
    .from("event_staff")
    .select("id, role, event:events(id, name, event_date, start_time, archived_at, status:event_statuses(name, color, text_color), venue:venues(name))")
    .eq("employee_id", me.id);

  const today = todayStr();
  const upcoming = (assignments ?? [])
    .map((a) => ({ role: a.role, event: a.event as unknown as { id: string; name: string; event_date: string | null; archived_at: string | null; status: { name: string; color: string; text_color: string } | null; venue: { name: string } | null } | null }))
    .filter((a) => a.event?.event_date && a.event.event_date >= today && !a.event.archived_at)
    .sort((a, b) => (a.event!.event_date! < b.event!.event_date! ? -1 : 1))
    .slice(0, 8);

  return (
    <div>
      <h2 className="card-title">My Upcoming Events</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Event</th>
              <th className="px-4 py-2">My Role</th>
              <th className="px-4 py-2">Venue</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((a) => (
              <tr key={a.event!.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className="px-4 py-2 whitespace-nowrap">{a.event!.event_date}</td>
                <td className="px-4 py-2">
                  <Link href={`/events/${a.event!.id}`} className="font-medium text-brand dark:text-brand-lighter hover:underline">
                    {a.event!.name || "(unnamed)"}
                  </Link>
                </td>
                <td className="px-4 py-2">{a.role}</td>
                <td className="px-4 py-2">{a.event!.venue?.name ?? "—"}</td>
              </tr>
            ))}
            {upcoming.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No upcoming assignments.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
