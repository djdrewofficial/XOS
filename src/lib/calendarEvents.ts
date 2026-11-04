import type { SupabaseClient } from "@supabase/supabase-js";
import { sortDayEvents, type CalDetailedEvent } from "@/lib/dayEvents";

type AddonRow = { event_id: string; quantity: number; addon: unknown };
type StaffRow = { event_id: string; role: string | null; employee: unknown };

/** Events in an inclusive date range, shaped for the day cards. Archived events
 *  are excluded the same way the dashboard calendar always has. */
export async function loadEventsByDate(
  supabase: SupabaseClient,
  start: string,
  end: string,
): Promise<Record<string, CalDetailedEvent[]>> {
  const { data: rows } = await supabase
    .from("events")
    .select(
      "id, name, event_date, start_time, end_time, client:clients(first_name, last_name, cell_phone), venue:venues(name, city, state), package:packages(name), event_type:event_types(name), status:event_statuses(name, color, text_color)",
    )
    .is("archived_at", null)
    .gte("event_date", start)
    .lte("event_date", end)
    .order("event_date");

  const monthEvents = rows ?? [];
  const ids = monthEvents.map((e) => e.id as string);
  const [{ data: addonRows }, { data: staffRows }] = ids.length
    ? await Promise.all([
        supabase.from("event_addons").select("event_id, quantity, addon:addons(name)").in("event_id", ids),
        supabase.from("event_staff").select("event_id, role, employee:employees(first_name, last_name)").in("event_id", ids),
      ])
    : [{ data: [] as AddonRow[] }, { data: [] as StaffRow[] }];

  const addonsByEvent = new Map<string, { name: string; quantity: number }[]>();
  (addonRows ?? []).forEach((a) => {
    const name = (a.addon as unknown as { name?: string } | null)?.name;
    if (!name) return;
    const row = a as unknown as AddonRow;
    (addonsByEvent.get(row.event_id) ?? addonsByEvent.set(row.event_id, []).get(row.event_id)!).push({
      name,
      quantity: Number(row.quantity) || 1,
    });
  });
  const staffByEvent = new Map<string, { name: string; role: string | null }[]>();
  (staffRows ?? []).forEach((s) => {
    const row = s as unknown as StaffRow;
    const emp = row.employee as unknown as { first_name?: string; last_name?: string } | null;
    const name = `${emp?.first_name ?? ""} ${emp?.last_name ?? ""}`.trim();
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
