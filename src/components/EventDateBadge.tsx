"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DayEventCards from "@/components/dashboard/DayEventCards";
import { formatDayHeading, otherEventsOnDay, type CalDetailedEvent } from "@/lib/dayEvents";

function dateFromIso(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

type Box = { top: number; left: number; width: number; maxHeight: number };

/** The purple date block on an event page. Clicking it opens the same day cards
 *  the dashboard calendar shows for that date. */
export default function EventDateBadge({
  date,
  events,
  currentEventId,
}: {
  date: string | null;
  events: CalDetailedEvent[];
  currentEventId: string;
}) {
  const dateObj = dateFromIso(date);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(44 * 16, window.innerWidth - 16);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    const top = r.bottom + 8;
    setBox({ top, left, width, maxHeight: Math.max(160, window.innerHeight - top - 12) });
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      btnRef.current?.focus();
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  const face = (
    <>
      <div className="bg-gradient-to-r from-brand to-brand-light py-0.5 text-[10px] font-black tracking-widest text-white uppercase">
        {dateObj ? dateObj.toLocaleString("en-US", { month: "short" }) : "TBD"}
      </div>
      <div className="bg-black/[0.05] pt-0.5 text-[8px] font-bold tracking-widest text-zinc-500 uppercase dark:bg-white/[0.06]">
        {dateObj ? dateObj.toLocaleString("en-US", { weekday: "long" }) : "—"}
      </div>
      <div className="bg-black/[0.05] text-xl leading-6 font-black text-zinc-900 dark:bg-white/[0.06] dark:text-white">
        {dateObj ? dateObj.getDate() : "?"}
      </div>
      <div className="bg-black/[0.05] pb-1 text-[9px] font-bold text-zinc-500 dark:bg-white/[0.06]">
        {dateObj ? dateObj.getFullYear() : ""}
      </div>
    </>
  );

  if (!dateObj || !date) {
    return (
      <div className="w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-300 text-center shadow-lg dark:border-white/15">
        {face}
      </div>
    );
  }

  const heading = formatDayHeading(date);
  const others = otherEventsOnDay(events, currentEventId);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Show events on ${heading}`}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          measure();
          setOpen(true);
        }}
        className={`w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-300 text-center shadow-lg transition hover:ring-2 hover:ring-brand focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-brand dark:border-white/15 ${
          open ? "ring-2 ring-brand" : ""
        }`}
      >
        {face}
      </button>
      {open && box && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={heading}
          style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
          className="fixed z-50 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 shadow-2xl dark:border-white/10 dark:bg-[#0b0913]"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="font-bold text-zinc-900 dark:text-white">{heading}</h2>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                btnRef.current?.focus();
              }}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-black/10 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
          {others.length === 0 && (
            <p className="mb-3 text-sm text-zinc-500">No other events on this day.</p>
          )}
          {events.length > 0 && <DayEventCards events={events} currentEventId={currentEventId} />}
        </div>
      )}
    </>
  );
}
