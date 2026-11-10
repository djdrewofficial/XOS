/* Data for the FIELD-STAFF event page (employee / marketing tier).

   Field staff only see events they're assigned to and no money except their own
   wage. Everything event-scoped is read from the money-free views (migration
   00217, see lib/eventSource) — the xos_fs_events read below is the access
   check: it returns nothing for an unassigned event, and every other query runs
   only after it succeeded. The admin event page (page.tsx) is untouched; this is
   a separate, read-mostly path. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Me } from "@/lib/auth";
import { eventSource } from "@/lib/eventSource";
import { isDoNotPlaySectionTitle } from "@/lib/planningNotes";

export const FIELD_STAFF_TABS = ["client", "details", "financials", "staff", "vendors", "logistics", "documents", "notes"] as const;
export type FieldStaffTab = (typeof FIELD_STAFF_TABS)[number];

type Named = { name: string } | null;
type Status = { name: string; color: string; text_color: string } | null;

export type FsEvent = {
  id: string;
  event_number: number | null;
  name: string | null;
  event_date: string | null;
  setup_time: string | null;
  start_time: string | null;
  end_time: string | null;
  guest_count: number | null;
  status_id: string | null;
  event_type_id: string | null;
  use_client_address: boolean | null;
  package_description_override: string | null;
  internal_notes: string | null;
  custom_fields: Record<string, unknown> | null;
  planning_seeded: boolean | null;
  archived_at: string | null;
  client: { id: string; first_name: string; last_name: string; cell_phone: string | null; email: string | null; organization: string | null; mailing_address: string | null } | null;
  status: Status;
  venue: {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    load_in_details: string | null;
    driving_notes: string | null;
    notes: string | null;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  venue_room: Named;
  package: { name: string; description: string | null; included_hours: number | null } | null;
  event_type: Named;
  salesperson: { first_name: string; last_name: string } | null;
  inquiry_source: Named;
};

export type FsStaff = {
  id: string;
  employee_id: string | null;
  role: string | null;
  first_name: string | null;
  last_name: string | null;
  stage_name: string | null;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  /** null unless this is the viewer's own row */
  flat_wage: number | null;
};

export type FieldStaffEventData = {
  event: FsEvent;
  clients: { id: string; role: string | null; is_primary: boolean; client: FsEvent["client"] }[];
  staff: FsStaff[];
  addons: { id: string; name: string | null; description: string | null; quantity: number }[];
  vendors: { id: string; role: string; notes: string | null; vendor: { id: string; company_name: string; category: string | null } | null }[];
  equipment: { id: string; quantity: number; notes: string | null; packed: boolean; item: Named; system: Named }[];
  notes: { id: string; body: string; kind: string | null; created_at: string; author_name?: string | null }[];
  files: { id: string; name: string; url: string | null; created_at: string }[];
  helpers: {
    id: string;
    title: string;
    button_text: string;
    button_bg: string;
    button_fg: string;
    button_font_size?: number | null;
    button_font_weight?: number | null;
    visible_status_ids: string[];
    hide_if_payment_made: boolean;
    hide_if_already_ran: boolean;
    hide_if_helpers_ran: string[];
    summary: string[];
  }[];
  ranHelperIds: string[];
  hasPayments: boolean;
  planner: {
    sections: { id: string; title: string; notes: string | null; staffNotes: string | null }[];
    doNotPlayText: string | null;
    doNotPlaySongs: { id: string; title: string; artist: string | null }[];
  } | null;
};

export async function loadFieldStaffEvent(
  supabase: SupabaseClient,
  me: Me,
  id: string,
  activeTab: FieldStaffTab,
): Promise<FieldStaffEventData | null> {
  const src = eventSource(true);
  const { data: event } = await supabase
    .from(src.events)
    .select(
      "*, client:clients(id, first_name, last_name, cell_phone, email, organization, mailing_address), status:event_statuses(name, color, text_color), venue:xos_fs_venues(*), venue_room:venue_rooms(name), package:xos_fs_packages(name, description, included_hours), event_type:event_types(name), salesperson:xos_fs_employees(first_name, last_name), inquiry_source:inquiry_sources(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!event) return null; // unassigned (or missing) — the view filtered it out
  const ev = event as unknown as FsEvent;

  const skip = Promise.resolve({ data: null });
  const want = (t: FieldStaffTab) => activeTab === t;
  const admin = createAdminClient();

  const [
    { data: clients },
    { data: staff },
    { data: addons },
    { data: vendors },
    { data: equipment },
    { data: notes },
    { data: files },
    { data: helpers },
    { data: ranRows },
    { count: paymentCount },
  ] = await Promise.all([
    supabase
      .from("event_clients")
      .select("id, role, is_primary, client:clients(id, first_name, last_name, cell_phone, email, organization, mailing_address)")
      .eq("event_id", id)
      .order("is_primary", { ascending: false })
      .order("created_at"),
    supabase.from(src.eventStaff).select("*").eq("event_id", id),
    supabase.from(src.eventAddons).select("id, name, description, quantity").eq("event_id", id),
    supabase
      .from("event_vendors")
      .select("id, role, notes, vendor:vendors(id, company_name, category)")
      .eq("event_id", id)
      .order("created_at"),
    supabase
      .from("event_equipment")
      .select("id, quantity, notes, packed, item:equipment_items(name), system:equipment_systems(name)")
      .eq("event_id", id)
      .order("created_at"),
    supabase.from("event_notes").select("*").eq("event_id", id).neq("kind", "contract").order("created_at", { ascending: false }),
    want("documents") || want("notes")
      ? supabase
          .from("event_files")
          .select("id, name, path, source, created_at, label:file_label_definitions(slug)")
          .eq("event_id", id)
          .is("hidden_at", null)
          .order("created_at", { ascending: false })
      : skip,
    supabase.from("booking_helpers").select("*").eq("is_active", true).order("position"),
    // helper bookkeeping (ids / a yes-no only) — booking_helper_runs and payments are
    // denied to field staff by 00218, so read them service-role, already scoped to an
    // event the viewer is assigned to
    admin.from("booking_helper_runs").select("helper_id").eq("event_id", id),
    admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("event_id", id)
      .eq("status", "approved")
      .is("deleted_at", null),
  ]);

  // timeline files only (same rule as the DB: label "timeline" or the planner's timeline export)
  type FileRow = { id: string; name: string; path: string; source: string | null; created_at: string; label: unknown };
  const timeline = ((files ?? []) as unknown as FileRow[]).filter(
    (f) => f.source === "planner_timeline" || (f.label as { slug?: string } | null)?.slug === "timeline",
  );
  const signed = await Promise.all(
    timeline.map(async (f) => {
      const { data } = await supabase.storage.from("event-files").createSignedUrl(f.path, 3600);
      return { id: f.id, name: f.name, created_at: f.created_at, url: data?.signedUrl ?? null };
    }),
  );

  // Field staff only get helpers that EXPLICITLY list their role — an empty
  // allowed_roles ("everyone") would otherwise hand them client-facing
  // contract / payment helpers.
  type HelperRow = FieldStaffEventData["helpers"][number] & {
    visible_event_type_ids?: string[] | null;
    allowed_roles?: string[] | null;
  };
  const visibleHelpers = ((helpers ?? []) as unknown as HelperRow[])
    .filter((h) => {
      const types = h.visible_event_type_ids ?? [];
      const typeOk = types.length === 0 || (!!ev.event_type_id && types.includes(ev.event_type_id));
      return typeOk && (h.allowed_roles ?? []).includes(me.role);
    })
    .map((h) => ({ ...h, summary: [] as string[] }));

  let planner: FieldStaffEventData["planner"] = null;
  if (want("notes")) {
    const [{ data: avoid }, { data: songRows }, { data: secs }, { data: staffNotes }] = await Promise.all([
      supabase.from("planning_do_not_play_notes").select("body").eq("event_id", id).maybeSingle(),
      supabase.from("planning_songs").select("id, title, artist, do_not_play, section_id").eq("event_id", id).order("sort_order"),
      supabase.from("planning_sections").select("id, title, section_type, client_notes").eq("event_id", id).order("sort_order"),
      supabase.from("planning_section_staff_notes").select("section_id, body").eq("event_id", id),
    ]);
    const avoidSections = new Set(
      (secs ?? []).filter((s) => isDoNotPlaySectionTitle(String(s.title ?? ""))).map((s) => s.id as string),
    );
    const seen = new Set<string>();
    const doNotPlaySongs: { id: string; title: string; artist: string | null }[] = [];
    for (const song of songRows ?? []) {
      const songId = song.id as string;
      const onList = Boolean(song.do_not_play) || avoidSections.has(song.section_id as string);
      if (!onList || seen.has(songId)) continue;
      seen.add(songId);
      doNotPlaySongs.push({ id: songId, title: (song.title as string) || "Untitled", artist: (song.artist as string | null) ?? null });
    }
    const staffById = new Map((staffNotes ?? []).map((r) => [r.section_id as string, (r.body as string | null) ?? null]));
    planner = {
      sections: (secs ?? [])
        .filter((s) => s.section_type !== "headline")
        .map((s) => ({
          id: s.id as string,
          title: (s.title as string) || "Moment",
          notes: (s.client_notes as string | null) ?? null,
          staffNotes: staffById.get(s.id as string) ?? null,
        })),
      doNotPlayText: (avoid?.body as string | null) ?? null,
      doNotPlaySongs,
    };
  }

  return {
    event: ev,
    clients: (clients ?? []) as unknown as FieldStaffEventData["clients"],
    staff: (staff ?? []) as unknown as FsStaff[],
    addons: (addons ?? []) as unknown as FieldStaffEventData["addons"],
    vendors: (vendors ?? []) as unknown as FieldStaffEventData["vendors"],
    equipment: (equipment ?? []) as unknown as FieldStaffEventData["equipment"],
    notes: (notes ?? []) as unknown as FieldStaffEventData["notes"],
    files: signed,
    helpers: visibleHelpers,
    ranHelperIds: (ranRows ?? []).map((r) => r.helper_id as string),
    hasPayments: (paymentCount ?? 0) > 0,
    planner,
  };
}
