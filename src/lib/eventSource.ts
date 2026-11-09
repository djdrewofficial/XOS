/* Where event data is read from, per viewer.

   Office tiers read the base tables. Field staff (employee / marketing — see
   Me.fieldStaff) read the money-free definer views from migration 00217, which
   only return events they are assigned to and drop every price / fee / amount
   column. After migration 00218 the base tables are denied to field staff at
   the database level, so anything a field-staff page reads MUST go through here.

   The XOS Mobile app mirrors this file (src/lib/eventSource.ts there) — keep
   the view names and columns in step. */

export type EventSource = {
  fieldStaff: boolean;
  events: "events" | "xos_fs_events";
  venues: "venues" | "xos_fs_venues";
  packages: "packages" | "xos_fs_packages";
  eventAddons: "event_addons" | "xos_fs_event_addons";
  eventStaff: "event_staff" | "xos_fs_event_staff";
  employees: "employees" | "xos_fs_employees";
};

export function eventSource(fieldStaff: boolean): EventSource {
  return fieldStaff
    ? {
        fieldStaff: true,
        events: "xos_fs_events",
        venues: "xos_fs_venues",
        packages: "xos_fs_packages",
        eventAddons: "xos_fs_event_addons",
        eventStaff: "xos_fs_event_staff",
        employees: "xos_fs_employees",
      }
    : {
        fieldStaff: false,
        events: "events",
        venues: "venues",
        packages: "packages",
        eventAddons: "event_addons",
        eventStaff: "event_staff",
        employees: "employees",
      };
}

/** Columns of xos_fs_events (migration 00217). Everything on `events` except
    money: package_price_override/locked, deposit_value, travel_fee, overtime_fee,
    discount1/2 label+amount, schedule_ack_total, pay_token, autopay_*,
    billing_terms(_count), legacy_djep_id. */
export const FS_EVENT_COLUMNS = [
  "id", "event_number", "name", "event_date", "setup_time", "start_time", "end_time",
  "guest_count", "client_id", "venue_id", "venue_room_id", "use_client_address",
  "package_id", "package_version_no", "package_description_override",
  "status_id", "event_type_id", "salesperson_id", "inquiry_source_id",
  "point_of_contact_employee_id", "journey_type_id",
  "internal_notes", "custom_fields", "planning_seeded", "planning_template_id",
  "overtime_hours", "hide_financials", "comms_paused",
  "initial_contact_date", "quote_sent_date", "contract_sent_date", "contract_due_date",
  "contract_signed_date", "booked_date",
  "decision_maker_name", "decision_maker_phone", "decision_maker_email",
  "cover_photo_url", "cover_photo_updated_by", "cover_photo_hidden_at", "cover_photo_hidden_by",
  "archived_at", "created_at", "updated_at",
] as const;

/** Events list (/events) select. Field staff get no fees on the venue/package
    embeds; salesperson comes from the names-only employees view. */
export function eventsListSelect(src: EventSource): string {
  return src.fieldStaff
    ? "*, client:clients(first_name, last_name, cell_phone, email), status:event_statuses(name, color, text_color), package:xos_fs_packages(name), venue:xos_fs_venues(name, city, state), event_type:event_types(name), salesperson:xos_fs_employees(first_name, last_name), inquiry_source:inquiry_sources(name)"
    : "*, client:clients(first_name, last_name, cell_phone, email), status:event_statuses(name, color, text_color), package:packages(name, default_price, deposit_value), venue:venues(name, city, state, setup_fee), event_type:event_types(name), salesperson:employees(first_name, last_name), inquiry_source:inquiry_sources(name)";
}

/** Calendar day-card select (lib/calendarEvents). */
export function calendarSelect(src: EventSource): string {
  return `id, name, event_date, start_time, end_time, client:clients(first_name, last_name, cell_phone), venue:${src.venues}(name, city, state), package:${src.packages}(name), event_type:event_types(name), status:event_statuses(name, color, text_color)`;
}

/** Add-on rows with the add-on name: the view carries `name` directly, the base
    table embeds the catalog row. Normalize with addonName(). */
export function addonNameSelect(src: EventSource): string {
  return src.fieldStaff ? "event_id, quantity, name" : "event_id, quantity, addon:addons(name)";
}
export function addonName(row: { name?: string | null; addon?: unknown }): string | null {
  if (row.name) return row.name;
  return (row.addon as { name?: string } | null)?.name ?? null;
}

/** Staff rows with the employee's name: the view carries names directly. */
export function staffNameSelect(src: EventSource): string {
  return src.fieldStaff
    ? "event_id, role, first_name, last_name"
    : "event_id, role, employee:employees(first_name, last_name)";
}
export function staffName(row: { first_name?: string | null; last_name?: string | null; employee?: unknown }): string {
  const emp = (row.employee as { first_name?: string; last_name?: string } | null) ?? row;
  return `${emp?.first_name ?? ""} ${emp?.last_name ?? ""}`.trim();
}
