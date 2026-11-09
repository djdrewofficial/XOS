import type { SupabaseClient } from "@supabase/supabase-js";
import { sortDayEvents, type CalDetailedEvent } from "@/lib/dayEvents";
import {
  eventSource,
  calendarSelect,
  addonNameSelect,
  addonName,
  staffNameSelect,
  staffName,
  type EventSource,
} from "@/lib/eventSource";

type AddonRow = { event_id: string; quantity: number; addon?: unknown; name?: string | null };
type StaffRow = { event_id: string; role: string | null; employee?: unknown; first_name?: string | null; last_name?: string | null };

/** Events in an inclusive date range, shaped for the day cards. Archived events
 *  are excluded the same way the dashboard calendar always has. Field staff
 *  (src.fieldStaff) read the money-free views, so they only get assigned events. */
export async function loadEventsByDate(
  supabase: SupabaseClient,
  start: string,
  end: string,
  src: EventSource = eventSource(false),
): Promise<Record<string, CalDetailedEvent[]>> {
  const { data: rows } = await supabase
    .from(src.events)
    .select(calendarSelect(src))
    .is("archived_at", null)
    .gte("event_date", start)
    .lte("event_date", end)
    .order("event_date");

  const monthEvents = (rows ?? []) as unknown as Record<string, unknown>[];
  const ids = monthEvents.map((e) => e.id as string);
  const [{ data: addonRows }, { data: staffRows }] = ids.length
    ? await Promise.all([
        supabase.from(src.eventAddons).select(addonNameSelect(src)).in("event_id", ids),
        supabase.from(src.eventStaff).select(staffNameSelect(src)).in("event_id", ids),
      ])
    : [{ data: [] as AddonRow[] }, { data: [] as StaffRow[] }];

  const addonsByEvent = new Map<string, { name: string; quantity: number }[]>();
  ((addonRows ?? []) as unknown as AddonRow[]).forEach((a) => {
    const name = addonName(a);
    if (!name) return;
    const row = a;
    (addonsByEvent.get(row.event_id) ?? addonsByEvent.set(row.event_id, []).get(row.event_id)!).push({
      name,
      quantity: Number(row.quantity) || 1,
    });
  });
  const staffByEvent = new Map<string, { name: string; role: string | null }[]>();
  ((staffRows ?? []) as unknown as StaffRow[]).forEach((row) => {
    const name = staffName(row);
    if (!name) return;
    (staffByEvent.get(row.event_id) ?? staffByEvent.set(row.event_id, []).get(row.event_id)!).push({
      name,
      role: row.role ?? null,
    });
  });

  const eventsByDate: Record<string, CalDetailedEvent[]> = {};
  monthEvents.forEach((e) => {
    const date = e.event_date as string | null;
    if (!date) return;
    const id = e.id as string;
    const det: CalDetailedEvent = {
      id,
      name: (e.name as string | null) ?? null,
      start_time: (e.start_time as string | null) ?? null,
      end_time: (e.end_time as string | null) ?? null,
      status: e.status as unknown as CalDetailedEvent["status"],
      client: e.client as unknown as CalDetailedEvent["client"],
      venue: e.venue as unknown as CalDetailedEvent["venue"],
      package_name: (e.package as unknown as { name?: string } | null)?.name ?? null,
      event_type_name: (e.event_type as unknown as { name?: string } | null)?.name ?? null,
      addons: addonsByEvent.get(id) ?? [],
      staff: staffByEvent.get(id) ?? [],
    };
    (eventsByDate[date] ??= []).push(det);
  });

  for (const date of Object.keys(eventsByDate)) {
    eventsByDate[date] = sortDayEvents(eventsByDate[date]);
  }
  return eventsByDate;
}
