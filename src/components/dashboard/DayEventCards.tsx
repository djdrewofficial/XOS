import Link from "next/link";
import { dayEventCardModel, sortDayEvents, type CalDetailedEvent, type DayEventCardModel } from "@/lib/dayEvents";

/** Side-by-side day cards. Used by the dashboard day panel and the event-page
 *  date badge so both stay the same. Every card is expanded: time, status,
 *  client, venue, type, package, phone, add-ons, and staff. */
export default function DayEventCards({
  events,
  currentEventId = null,
  selectedId = null,
  emptyLabel = "No events on this day.",
}: {
  events: CalDetailedEvent[];
  /** Event the viewer is already on. Its card is marked and is not a link. */
  currentEventId?: string | null;
  /** Pill the calendar has selected. Still a link — the second pill tap opens it. */
  selectedId?: string | null;
  emptyLabel?: string;
}) {
  const sorted = sortDayEvents(events);
  if (sorted.length === 0) {
    return <p className="py-4 text-center text-sm text-zinc-500">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap items-stretch gap-3">
      {sorted.map((e) => {
        const current = currentEventId != null && e.id === currentEventId;
        const selected = !current && selectedId != null && e.id === selectedId;
        return (
          <div key={e.id} className="flex min-w-[min(100%,18rem)] flex-1 basis-[22rem]">
            <DayEventCard model={dayEventCardModel(e)} current={current} selected={selected} />
          </div>
        );
      })}
    </div>
  );
}

function DayEventCard({
  model,
  current,
  selected,
}: {
  model: DayEventCardModel;
  current: boolean;
  selected: boolean;
}) {
  const className = [
    "flex h-full w-full flex-col rounded-xl border p-3 text-left shadow-sm transition-colors",
    current
      ? "border-brand bg-brand/5 ring-2 ring-brand/40 dark:bg-brand/10"
      : selected
        ? "border-brand bg-white ring-2 ring-brand dark:bg-zinc-900"
        : "border-zinc-200 bg-white hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-white/10 dark:bg-zinc-900 dark:hover:border-brand-light",
  ].join(" ");

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {model.startLabel && (
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{model.startLabel}</span>
        )}
        {model.status && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: model.status.color, color: model.status.text_color }}
          >
            {model.status.name}
          </span>
        )}
        {current && (
          <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand dark:text-brand-lighter">
            This event
          </span>
        )}
      </div>
      <div className="mt-1 text-sm font-semibold leading-snug text-zinc-900 dark:text-white">{model.title}</div>

      {model.rows.length > 0 && (
        <dl className="mt-3 space-y-1.5 text-sm">
          {model.rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-3">
              <dt className="text-zinc-500">{row.label}</dt>
              <dd className="text-right font-medium text-zinc-800 dark:text-zinc-200">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {model.addons.length > 0 && (
        <div className="mt-2.5">
          <div className="label-xs">Add-ons</div>
          <ul className="mt-0.5 space-y-0.5 text-sm">
            {model.addons.map((a, j) => (
              <li key={`${a.name}-${j}`} className="flex justify-between text-zinc-600 dark:text-zinc-300">
                <span>{a.name}</span>
                <span className="text-zinc-400">× {a.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {model.staff.length > 0 && (
        <div className="mt-2.5">
          <div className="label-xs">Staff</div>
          <ul className="mt-0.5 space-y-0.5 text-sm">
            {model.staff.map((s, j) => (
              <li key={`${s.name}-${j}`} className="flex justify-between gap-3 text-zinc-600 dark:text-zinc-300">
                <span>{s.name}</span>
                {s.role && <span className="text-right text-zinc-400">{s.role}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto pt-3">
        {current ? (
          <span className="text-xs font-semibold text-zinc-400">Viewing this event</span>
        ) : (
          <span className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-brand to-brand-light px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-brand/30">
            Open event
          </span>
        )}
      </div>
    </>
  );

  if (current) {
    return (
      <div className={className} aria-current="page">
        {body}
      </div>
    );
  }

  return (
    <Link href={model.href} className={className}>
      {body}
    </Link>
  );
}
