"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DayEventCards from "@/components/dashboard/DayEventCards";
import {
  eventTitle,
  formatDayHeading,
  selectionAfterDayClick,
  selectionAfterEventClick,
  type CalendarSelection,
  type CalDetailedEvent,
} from "@/lib/dayEvents";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Cell = { date: string; inMonth: boolean; dayNum: number };

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
  const [selection, setSelection] = useState<CalendarSelection>({ date: null, eventId: null });
  // Updated synchronously so a fast second tap (before React re-renders) still
  // sees the event as already selected and opens it.
  const selectionRef = useRef(selection);
  const applySelection = (next: CalendarSelection) => {
    selectionRef.current = next;
    setSelection(next);
  };

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

  const selectedEvents = selection.date ? eventsByDate[selection.date] ?? [] : [];

  // A pill tap selects that event and opens its day. A second tap on the same
  // already-selected pill opens the event page. stopPropagation so the day
  // cell's click (which clears the pill selection) does not also run.
  const onEventPill = (eventId: string, date: string) => {
    const next = selectionAfterEventClick(selectionRef.current, { id: eventId, date });
    if (next.navigateTo) {
      router.push(next.navigateTo);
      return;
    }
    applySelection(next.selection);
  };

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
          const isSelected = cell.date === selection.date;
          return (
            <div
              key={cell.date}
              onClick={() => applySelection(selectionAfterDayClick(cell.date))}
              className={`min-h-28 border-zinc-100 p-1 text-left align-top dark:border-white/[0.05] ${i % 7 !== 0 ? "border-l" : ""} ${
                i >= 7 ? "border-t" : ""
              } ${cell.inMonth ? "" : "bg-zinc-100/80 dark:bg-black/30"} ${
                isSelected ? "ring-2 ring-inset ring-brand" : isToday ? "bg-brand/25 ring-1 ring-inset ring-brand-light/50" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              }`}
            >
              <div className="mb-1 text-right">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    applySelection(selectionAfterDayClick(cell.date));
                  }}
                  aria-pressed={isSelected}
                  aria-label={`Show ${formatDayHeading(cell.date)}`}
                  className={`px-1 text-xs font-semibold ${
                    isToday ? "text-brand dark:text-brand-lighter" : cell.inMonth ? "text-zinc-600 dark:text-zinc-400" : "text-zinc-400 dark:text-zinc-700"
                  }`}
                >
                  {cell.dayNum}
                </button>
              </div>
              <div className="space-y-0.5">
                {holiday && (
                  <div className="truncate rounded bg-sky-700/70 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:text-sky-100">{holiday}</div>
                )}
                {dayEvents.map((e) => {
                  const pillSelected = isSelected && selection.eventId === e.id;
                  const title = eventTitle(e);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      aria-pressed={pillSelected}
                      aria-label={pillSelected ? `Open ${title}` : `${e.status?.name ? `${e.status.name} - ` : ""}${title}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onEventPill(e.id, cell.date);
                      }}
                      className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-semibold shadow-sm ${
                        pillSelected ? "ring-2 ring-zinc-900 ring-offset-1 ring-offset-white dark:ring-white dark:ring-offset-zinc-950" : ""
                      }`}
                      style={{ backgroundColor: e.status?.color ?? "#97CC9A", color: e.status?.text_color ?? "#000" }}
                    >
                      {e.status?.name ? `${e.status.name} - ` : ""}
                      {title}
                    </button>
                  );
                })}
                {off.map((name, j) => (
                  <div key={j} className="truncate rounded bg-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    Time Off - {name}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selection.date && (
        <div className="border-t border-zinc-200 bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-zinc-900 dark:text-white">{formatDayHeading(selection.date)}</h3>
            <button
              type="button"
              onClick={() => applySelection({ date: null, eventId: null })}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-black/10 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
          <DayEventCards events={selectedEvents} selectedId={selection.eventId} />
        </div>
      )}
    </div>
  );
}
