// Shared day-event model for the dashboard calendar and the event-page date badge.
// Pure data + click decisions so both surfaces stay identical and the tests can
// run under node:test (no DOM).

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

export type CalendarSelection = { date: string | null; eventId: string | null };

export type CardRow = { label: string; value: string };

export type DayEventCardModel = {
  id: string;
  href: string;
  title: string;
  startLabel: string | null;
  status: CalDetailedEvent["status"];
  rows: CardRow[];
  addons: CalDetailedEvent["addons"];
  staff: CalDetailedEvent["staff"];
};

/** First click on a pill selects it (and its day). A later click on that same
 *  already-selected pill opens the event. A different pill only changes the
 *  selection — this is a second tap, not a double-click, so touch works. */
export function selectionAfterEventClick(
  current: CalendarSelection,
  event: { id: string; date: string },
): { selection: CalendarSelection; navigateTo: string | null } {
  if (current.date === event.date && current.eventId === event.id) {
    return { selection: current, navigateTo: `/events/${event.id}` };
  }
  return { selection: { date: event.date, eventId: event.id }, navigateTo: null };
}

/** Clicking the day itself opens that day's panel and clears any pill selection,
 *  so the next tap on a pill selects rather than navigates. */
export function selectionAfterDayClick(date: string): CalendarSelection {
  return { date, eventId: null };
}

export function formatEventTime(t: string | null): string | null {
  if (!t) return null;
  const d = new Date(`1970-01-01T${t}`);
  return isNaN(d.getTime()) ? t : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatDayHeading(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function eventTitle(e: Pick<CalDetailedEvent, "client" | "name">): string {
  if (e.client) {
    const name = `${e.client.first_name} ${e.client.last_name}`.trim();
    if (name) return name;
  }
  return e.name || "Event";
}

export function eventClientName(client: CalDetailedEvent["client"]): string | null {
  if (!client) return null;
  const name = `${client.first_name} ${client.last_name}`.trim();
  return name || null;
}

export function eventVenueLine(venue: CalDetailedEvent["venue"]): string | null {
  if (!venue?.name) return null;
  const place = [venue.city, venue.state].filter(Boolean).join(", ");
  return [venue.name, place].filter(Boolean).join(" — ");
}

/** Chronological within the day (unset times last) so pills and cards match. */
export function sortDayEvents<T extends { start_time: string | null; id: string }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => {
    const ta = a.start_time ?? "99:99:99";
    const tb = b.start_time ?? "99:99:99";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function otherEventsOnDay<T extends { id: string }>(events: readonly T[], currentId: string | null): T[] {
  if (!currentId) return [...events];
  return events.filter((e) => e.id !== currentId);
}

/** Everything the old day-panel row showed once expanded, plus event type
 *  (already loaded for the calendar, previously unused in the row). */
export function dayEventCardModel(e: CalDetailedEvent): DayEventCardModel {
  const start = formatEventTime(e.start_time);
  const end = formatEventTime(e.end_time);
  const rows: CardRow[] = [];
  if (start || end) rows.push({ label: "Start / End", value: [start, end].filter(Boolean).join(" – ") });
  const client = eventClientName(e.client);
  if (client) rows.push({ label: "Client", value: client });
  const venue = eventVenueLine(e.venue);
  if (venue) rows.push({ label: "Venue", value: venue });
  if (e.status?.name) rows.push({ label: "Status", value: e.status.name });
  if (e.name) rows.push({ label: "Event Name", value: e.name });
  if (e.event_type_name) rows.push({ label: "Type", value: e.event_type_name });
  if (e.client?.cell_phone) rows.push({ label: "Cell Phone", value: e.client.cell_phone });
  if (e.package_name) rows.push({ label: "Package", value: e.package_name });
  return {
    id: e.id,
    href: `/events/${e.id}`,
    title: eventTitle(e),
    startLabel: start,
    status: e.status,
    rows,
    addons: e.addons,
    staff: e.staff,
  };
}
