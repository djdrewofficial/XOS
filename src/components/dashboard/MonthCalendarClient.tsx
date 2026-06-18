"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type CalDetailedEvent = {
  id: string;
  name: string | null;
  start_time: string | null;
  end_time: string | null;
  status: { name: string; color: string; text_color: string } | null;
  client: { first_name: string; last_name: string; cell_phone: string | null } | null;
  venue: { name: string | null; city: string | null; state: string | null } | null;
  package_name: string | null;
  event_type_name: string | null;
  addons: { name: string; quantity: number }[];
  staff: { name: string; role: string | null }[];
};

type Cell = { date: string; inMonth: boolean; dayNum: number };

function fmtTime(t: string | null): string | null {
  if (!t) return null;
  const d = new Date(`1970-01-01T${t}`);
  return isNaN(d.getTime()) ? t : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function eventTitle(e: CalDetailedEvent): string {
  if (e.client) return `${e.client.first_name} ${e.client.last_name}`.trim();
  return e.name || "Event";
}

export default function MonthCalendarClient({
  cells,
  eventsByDate,
  holidaysByDate,
  timeOffByDate,
  today,
  monthLabel,
  year,
  month,
  prevHref,
  nextHref,
  eventsThisMonth,
}: {
  cells: Cell[];
  eventsByDate: Record<string, CalDetailedEvent[]>;
  holidaysByDate: Record<string, string>;
  timeOffByDate: Record<string, string[]>;
  today: string;
  monthLabel: string;
  year: number;
  /** 0-based month of the displayed calendar. */
  month: number;
  prevHref: string;
  nextHref: string;
  eventsThisMonth: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // guard against a missing/invalid prop so the dropdowns never render NaN
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(month) ? month : new Date().getMonth();

  const jump = (y: number, m: number) =>
    router.push(`/?m=${y}-${String(m + 1).padStart(2, "0")}`);

  // years run from 2022 up to a few years past whatever month is on screen
  const START_YEAR = 2022;
  const endYear = Math.max(safeYear + 5, 2030);
  const years: number[] = [];
  for (let y = START_YEAR; y <= endYear; y++) years.push(y);

  const selectDay = (date: string) => {
    setSelected(date);
    setExpanded(null);
    const evs = eventsByDate[date] ?? [];
    if (evs.length === 1) setExpanded(evs[0].id); // auto-open a single event
  };

  const selectedEvents = selected ? eventsByDate[selected] ?? [] : [];

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={prevHref} className="btn-ghost px-3 py-1.5 text-xs">←</Link>
          <Link href={nextHref} className="btn-ghost px-3 py-1.5 text-xs">→</Link>
          <Link href="/" className="btn-ghost px-3 py-1.5 text-xs">today</Link>
          <select
            aria-label="Jump to month"
            value={safeMonth}
            onChange={(e) => jump(safeYear, Number(e.target.value))}
            className="input px-2 py-1.5 text-xs"
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i}>{name}</option>
            ))}
          </select>
          <select
            aria-label="Jump to year"
            value={safeYear}
            onChange={(e) => jump(Number(e.target.value), safeMonth)}
            className="input px-2 py-1.5 text-xs"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{monthLabel}</h2>
        <div className="text-xs text-zinc-500">{eventsThisMonth} events this month</div>
      </div>

      <div className="grid grid-cols-7 border-b border-zinc-200 bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const dayEvents = eventsByDate[cell.date] ?? [];
          const off = timeOffByDate[cell.date] ?? [];
          const holiday = holidaysByDate[cell.date];
          const isToday = cell.date === today;
          const isSelected = cell.date === selected;
          return (
            <button
              type="button"
              key={cell.date}
              onClick={() => selectDay(cell.date)}
              className={`min-h-28 border-zinc-100 p-1 text-left align-top dark:border-white/[0.05] ${i % 7 !== 0 ? "border-l" : ""} ${
                i >= 7 ? "border-t" : ""
              } ${cell.inMonth ? "" : "bg-zinc-100/80 dark:bg-black/30"} ${
                isSelected ? "ring-2 ring-inset ring-brand" : isToday ? "bg-brand/25 ring-1 ring-inset ring-brand-light/50" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              }`}
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
                  <div className="truncate rounded bg-sky-700/70 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:text-sky-100">{holiday}</div>
                )}
                {dayEvents.map((e) => (
                  <div
                    key={e.id}
                    className="truncate rounded px-1.5 py-0.5 text-[10px] font-semibold shadow-sm"
                    style={{ backgroundColor: e.status?.color ?? "#97CC9A", color: e.status?.text_color ?? "#000" }}
                  >
                    {e.status?.name ? `${e.status.name} - ` : ""}
                    {eventTitle(e)}
                  </div>
                ))}
                {off.map((name, j) => (
                  <div key={j} className="truncate rounded bg-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    Time Off - {name}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="border-t border-zinc-200 bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-zinc-900 dark:text-white">
              {new Date(`${selected}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </h3>
            <button type="button" onClick={() => setSelected(null)} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-black/10 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
              ✕
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-500">No events on this day.</p>
          ) : (
            <ul className="space-y-2">
              {selectedEvents.map((e) => {
                const open = expanded === e.id;
                return (
                  <li key={e.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-white/10 dark:bg-zinc-900">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : e.id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {fmtTime(e.start_time) && <span className="shrink-0 font-semibold text-zinc-700 dark:text-zinc-200">{fmtTime(e.start_time)}</span>}
                        {e.status && (
                          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: e.status.color, color: e.status.text_color }}>
                            {e.status.name}
                          </span>
                        )}
                        <span className="truncate text-zinc-600 dark:text-zinc-300">{eventTitle(e)}</span>
                      </span>
                      <span className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                    </button>

                    {open && (
                      <div className="border-t border-zinc-100 px-3 py-3 text-sm dark:border-white/[0.06]">
                        <dl className="space-y-1.5">
                          {(fmtTime(e.start_time) || fmtTime(e.end_time)) && (
                            <Row label="Start / End">{[fmtTime(e.start_time), fmtTime(e.end_time)].filter(Boolean).join(" – ") || "—"}</Row>
                          )}
                          {e.client && <Row label="Client">{`${e.client.first_name} ${e.client.last_name}`.trim()}</Row>}
                          {e.venue?.name && <Row label="Venue">{[e.venue.name, [e.venue.city, e.venue.state].filter(Boolean).join(", ")].filter(Boolean).join(" — ")}</Row>}
                          {e.status && <Row label="Status">{e.status.name}</Row>}
                          {e.name && <Row label="Event Name">{e.name}</Row>}
                          {e.client?.cell_phone && <Row label="Cell Phone">{e.client.cell_phone}</Row>}
                          {e.package_name && <Row label="Package">{e.package_name}</Row>}
                        </dl>

                        {e.addons.length > 0 && (
                          <div className="mt-2.5">
                            <div className="label-xs">Add-ons</div>
                            <ul className="mt-0.5 space-y-0.5">
                              {e.addons.map((a, j) => (
                                <li key={j} className="flex justify-between text-zinc-600 dark:text-zinc-300">
                                  <span>{a.name}</span>
                                  <span className="text-zinc-400">× {a.quantity}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {e.staff.length > 0 && (
                          <div className="mt-2.5">
                            <div className="label-xs">Staff</div>
                            <ul className="mt-0.5 space-y-0.5">
                              {e.staff.map((s, j) => (
                                <li key={j} className="flex justify-between text-zinc-600 dark:text-zinc-300">
                                  <span>{s.name}</span>
                                  {s.role && <span className="text-zinc-400">{s.role}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <Link href={`/events/${e.id}`} className="mt-3 inline-block text-xs font-semibold text-brand hover:underline dark:text-brand-lighter">
                          Open event →
                        </Link>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  );
}
