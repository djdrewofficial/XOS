/* Event creation shared by the web "Add Event" onboarding form (server action
   createEventOnboarding in app/(app)/events/actions.ts) and the XOS Mobile
   endpoint POST /api/mobile/events — one create path, so an event made from the
   phone is identical to one made on the web (package date/weekday pricing,
   default add-ons + equipment, deposit default, schedule rows, automations).

   NOT a "use server" module on purpose: these take a Supabase client argument
   and must never be exposed as client-callable server actions. Callers do the
   auth (requireModule / requireMobileStaffModule + office-only). */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildScheduleRows, parseSchedulePlan, type SchedulePlan } from "@/lib/paymentSchedule";
import { loadEventBundle } from "@/lib/documentRender";
import { buildEventName, type NamingClient } from "@/lib/eventName";
import { findOrCreateClient } from "@/lib/clients";
import { assignAddonSections } from "@/lib/planning";

// Resolve the package price for a date: Custom Date Range > weekday price > default.
// Snapshot semantics (DJEP parity): applied when the package is selected; later
// package-setting changes don't reprice saved events.
export async function applyPackageSelection(
  supabase: SupabaseClient,
  eventId: string,
  packageId: string,
  eventDate: string | null,
  manualOverride: boolean
) {
  const { data: pkg } = await supabase
    .from("packages")
    .select("default_price, deposit_value, deposit_pct, weekday_prices")
    .eq("id", packageId)
    .single();
  if (!pkg) return;

  let effective = Number(pkg.default_price);
  if (eventDate) {
    const weekday = (pkg.weekday_prices as Record<string, number> | null) ?? {};
    const [y, m, d] = eventDate.split("-").map(Number);
    const dow = String(new Date(y, m - 1, d).getDay());
    if (weekday[dow] !== undefined) effective = Number(weekday[dow]);

    const { data: ranges } = await supabase
      .from("package_date_prices")
      .select("price")
      .eq("package_id", packageId)
      .lte("start_date", eventDate)
      .gte("end_date", eventDate)
      .order("created_at", { ascending: false })
      .limit(1);
    if (ranges && ranges.length) effective = Number(ranges[0].price);
  }

  const updates: Record<string, unknown> = {};
  if (!manualOverride) {
    updates.package_price_override = effective !== Number(pkg.default_price) ? effective : null;
  }
  // default the deposit if none set yet
  const { data: ev } = await supabase
    .from("events")
    .select("deposit_value")
    .eq("id", eventId)
    .single();
  if (ev && Number(ev.deposit_value) === 0) {
    if (pkg.deposit_pct != null && Number(pkg.deposit_pct) > 0) {
      updates.deposit_value = Math.round(effective * Number(pkg.deposit_pct)) / 100;
    } else if (Number(pkg.deposit_value) > 0) {
      updates.deposit_value = Number(pkg.deposit_value);
    }
  }
  if (Object.keys(updates).length) {
    await supabase.from("events").update(updates).eq("id", eventId);
  }

  // auto-assign the package's default add-ons (skip ones already on the event)
  const { data: addonDefaults } = await supabase
    .from("package_addon_defaults")
    .select("addon_id, quantity")
    .eq("package_id", packageId);
  if (addonDefaults?.length) {
    const { data: existing } = await supabase
      .from("event_addons")
      .select("addon_id")
      .eq("event_id", eventId);
    const have = new Set((existing ?? []).map((x) => x.addon_id));
    const rows = addonDefaults
      .filter((a) => !have.has(a.addon_id))
      .map((a) => ({ event_id: eventId, addon_id: a.addon_id, quantity: a.quantity }));
    if (rows.length) await supabase.from("event_addons").insert(rows);
    // pull each auto-added add-on's equipment onto the logistics checklist too
    for (const r of rows) {
      await assignAddonEquipment(supabase, eventId, r.addon_id);
      await assignAddonSections(eventId, r.addon_id);
    }
  }

  // auto-assign the package's default equipment to the logistics checklist
  const { data: equipDefaults } = await supabase
    .from("package_equipment_defaults")
    .select("item_id, system_id, quantity")
    .eq("package_id", packageId);
  if (equipDefaults?.length) {
    const { data: existing } = await supabase
      .from("event_equipment")
      .select("item_id, system_id")
      .eq("event_id", eventId);
    const haveItems = new Set((existing ?? []).map((x) => x.item_id).filter(Boolean));
    const haveSystems = new Set((existing ?? []).map((x) => x.system_id).filter(Boolean));
    const rows = equipDefaults
      .filter((e) => (e.item_id ? !haveItems.has(e.item_id) : !haveSystems.has(e.system_id)))
      .map((e) => ({
        event_id: eventId,
        item_id: e.item_id,
        system_id: e.system_id,
        quantity: e.quantity,
      }));
    if (rows.length) await supabase.from("event_equipment").insert(rows);
  }
}


export async function assignAddonEquipment(
  supabase: SupabaseClient,
  eventId: string,
  addonId: string
) {
  const { data: defaults } = await supabase
    .from("addon_equipment_defaults")
    .select("item_id, system_id, quantity")
    .eq("addon_id", addonId);
  if (!defaults?.length) return;
  const { data: existing } = await supabase
    .from("event_equipment")
    .select("item_id, system_id")
    .eq("event_id", eventId);
  const haveItems = new Set((existing ?? []).map((x) => x.item_id).filter(Boolean));
  const haveSystems = new Set((existing ?? []).map((x) => x.system_id).filter(Boolean));
  const rows = defaults
    .filter((e) => (e.item_id ? !haveItems.has(e.item_id) : !haveSystems.has(e.system_id)))
    .map((e) => ({ event_id: eventId, item_id: e.item_id, system_id: e.system_id, quantity: e.quantity }));
  if (rows.length) await supabase.from("event_equipment").insert(rows);
}


// ---- Tabbed onboarding: build the whole event from one submit ----
export type NewClient = {
  mode: "existing" | "new";
  client_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  cell_phone?: string;
  role?: string;
  is_primary?: boolean;
  is_contract_holder?: boolean;
};
export type NewDiscount = { label?: string; amount?: number };
export type NewAddon = { addon_id: string; quantity?: number; price_override?: number | null };
export type NewStaff = { employee_id: string; role?: string; flat_wage?: number };
export type NewDate = { definition_id: string; value?: string };
export type NewVenue = {
  name?: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
  place_id?: string | null;
};


/** Parsed create-event input (what the onboarding form and the mobile JSON both become). */
export type EventCreateInput = {
  clients: NewClient[];
  name: string | null;
  event_type_id: string | null;
  status_id: string | null;
  event_date: string | null;
  setup_time: string | null;
  start_time: string | null;
  end_time: string | null;
  guest_count: number | null;
  inquiry_source_id: string | null;
  new_source_name: string | null;
  new_source_persist: boolean;
  internal_notes: string | null;
  contract_notes: string | null;
  custom_dates: NewDate[];
  package_id: string | null;
  /** null = no manual override (date/weekday pricing applies) */
  package_price_override: number | null;
  /** null = not entered (package default deposit applies) */
  deposit_value: number | null;
  travel_fee: number;
  /** legacy form field "d1l" — wins over discounts[0].label when set */
  discount1_label: string | null;
  discounts: NewDiscount[];
  addons: NewAddon[];
  schedule_plan: SchedulePlan | null;
  use_client_address: boolean;
  client_address: string | null;
  venue_id: string | null;
  venue_room_id: string | null;
  new_venue: NewVenue | null;
  staff: NewStaff[];
};

function clean(v: FormDataEntryValue | null | undefined): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | number | null | undefined): number {
  const n = parseFloat((v ?? "0").toString());
  return Number.isFinite(n) ? n : 0;
}
function parseJson<T>(v: FormDataEntryValue | null, fallback: T): T {
  try {
    return v ? (JSON.parse(v.toString()) as T) : fallback;
  } catch {
    return fallback;
  }
}
const truthy = (v: FormDataEntryValue | null) => v === "true" || v === "on";

/** The onboarding form's FormData → EventCreateInput (field names unchanged). */
export function eventInputFromForm(formData: FormData): EventCreateInput {
  const priceOverride = clean(formData.get("package_price_override"));
  const depositInput = clean(formData.get("deposit_value"));
  return {
    clients: parseJson<NewClient[]>(formData.get("clients_json"), []),
    name: clean(formData.get("name")),
    event_type_id: clean(formData.get("event_type_id")),
    status_id: clean(formData.get("status_id")),
    event_date: clean(formData.get("event_date")),
    setup_time: clean(formData.get("setup_time")),
    start_time: clean(formData.get("start_time")),
    end_time: clean(formData.get("end_time")),
    guest_count: formData.get("guest_count") ? num(formData.get("guest_count")) : null,
    inquiry_source_id: clean(formData.get("inquiry_source_id")),
    new_source_name: clean(formData.get("new_source_name")),
    new_source_persist: truthy(formData.get("new_source_persist")),
    internal_notes: clean(formData.get("internal_notes")),
    contract_notes: clean(formData.get("contract_notes")),
    custom_dates: parseJson<NewDate[]>(formData.get("custom_dates_json"), []),
    package_id: clean(formData.get("package_id")),
    package_price_override: priceOverride ? num(priceOverride) : null,
    deposit_value: depositInput ? num(depositInput) : null,
    travel_fee: num(formData.get("travel_fee")),
    discount1_label: clean(formData.get("d1l")),
    discounts: parseJson<NewDiscount[]>(formData.get("discounts_json"), []),
    addons: parseJson<NewAddon[]>(formData.get("addons_json"), []),
    // full payment due OR deposit + split (legacy schedule_count still accepted)
    schedule_plan:
      parseSchedulePlan(formData.get("schedule_plan")) ??
      (formData.get("schedule_count") ? parseSchedulePlan(formData.get("schedule_count")) : null),
    use_client_address: truthy(formData.get("use_client_address")),
    client_address: clean(formData.get("client_address")),
    venue_id: clean(formData.get("venue_id")),
    venue_room_id: clean(formData.get("venue_room_id")),
    new_venue: parseJson<NewVenue | null>(formData.get("new_venue_json"), null),
    staff: parseJson<NewStaff[]>(formData.get("staff_json"), []),
  };
}

export type EventCreateOptions = {
  /** Passed to the event_created automations. "hold" queues their mail as held for a second approval. */
  drain?: "all" | "event" | "hold";
  /** Delete the new event and throw when a child insert fails, instead of leaving a partial event. */
  cleanupOnError?: boolean;
};

/** Create the event + everything hanging off it. Returns the new event id.
    Throws Error(message) on a validation / insert failure. */
export async function createEventCore(supabase: SupabaseClient, input: EventCreateInput, options: EventCreateOptions = {}): Promise<string> {
  const clients = input.clients;

  // Required-field guard on the primary client (backstop for the form's own
  // client-side validation): first name, last name, email, and cell must be set,
  // whether the primary is a new or an existing client.
  const primaryIn = clients.find((c) => c.is_primary) ?? clients[0];
  if (!primaryIn) throw new Error("Add a primary client before creating the event.");
  let pf = primaryIn.first_name, pl = primaryIn.last_name, pe = primaryIn.email, pc = primaryIn.cell_phone;
  if (primaryIn.mode === "existing" && primaryIn.client_id) {
    const { data: pc0 } = await supabase
      .from("clients")
      .select("first_name, last_name, email, cell_phone")
      .eq("id", primaryIn.client_id)
      .maybeSingle();
    pf = pc0?.first_name ?? pf; pl = pc0?.last_name ?? pl; pe = pc0?.email ?? pe; pc = pc0?.cell_phone ?? pc;
  }
  const missingPrimary = [
    !pf?.trim() && "first name",
    !pl?.trim() && "last name",
    !pe?.trim() && "email",
    !pc?.trim() && "cell phone",
  ].filter(Boolean);
  if (missingPrimary.length) throw new Error(`Primary client is missing: ${missingPrimary.join(", ")}.`);

  const discounts = input.discounts;
  const addons = input.addons;
  const staff = input.staff;
  const customDates = input.custom_dates;
  const newVenue = input.new_venue;

  // 1) resolve clients (create the new ones) and figure out the primary
  const resolved: { client_id: string; role: string | null; is_primary: boolean; is_contract_holder: boolean; naming: NamingClient }[] = [];
  for (const c of clients) {
    let id = c.client_id ?? null;
    let first = c.first_name ?? "";
    let last = c.last_name ?? "";
    if (c.mode === "new" || !id) {
      if (!first && !c.email && !c.cell_phone) continue; // skip empty rows
      // dedupe by email — reuse an existing client instead of creating a twin
      const found = await findOrCreateClient(supabase, {
        first_name: first,
        last_name: last,
        email: c.email,
        cell_phone: c.cell_phone,
      });
      id = found.id;
      first = found.first_name;
      last = found.last_name;
    } else {
      const { data: existing } = await supabase.from("clients").select("first_name, last_name").eq("id", id).maybeSingle();
      first = existing?.first_name ?? first;
      last = existing?.last_name ?? last;
    }
    resolved.push({
      client_id: id!,
      role: c.role ?? null,
      is_primary: !!c.is_primary,
      is_contract_holder: !!c.is_contract_holder,
      naming: { first_name: first, last_name: last, role: c.role ?? null, is_primary: !!c.is_primary },
    });
  }
  if (resolved.length && !resolved.some((r) => r.is_primary)) resolved[0].is_primary = true;
  const primary = resolved.find((r) => r.is_primary) ?? resolved[0] ?? null;

  // 2) resolve inquiry source (existing, or add new one-time/persisted)
  let inquirySourceId = input.inquiry_source_id;
  const newSourceName = input.new_source_name;
  if (!inquirySourceId && newSourceName) {
    const { data: src } = await supabase
      .from("inquiry_sources")
      .insert({ name: newSourceName, is_active: input.new_source_persist })
      .select("id")
      .single();
    inquirySourceId = src?.id ?? null;
  }

  // 3) resolve venue (existing, newly-created-from-Google, or client address)
  const useClientAddress = input.use_client_address;
  let venueId = input.venue_id;
  if (useClientAddress) {
    venueId = null;
    const addr = input.client_address;
    if (addr && primary) await supabase.from("clients").update({ mailing_address: addr }).eq("id", primary.client_id);
  } else if (!venueId && newVenue?.name) {
    const { data: v } = await supabase
      .from("venues")
      .insert({
        name: newVenue.name,
        address: newVenue.address ?? null,
        city: newVenue.city ?? null,
        state: newVenue.state ?? null,
        zip: newVenue.zip ?? null,
        lat: newVenue.lat ?? null,
        lng: newVenue.lng ?? null,
        google_place_id: newVenue.place_id ?? null,
      })
      .select("id")
      .single();
    venueId = v?.id ?? null;
  }
  // a room only makes sense on a venue picked from the list — and it must be that venue's room
  let venueRoomId: string | null = null;
  if (venueId && input.venue_id === venueId && input.venue_room_id) {
    const { data: room } = await supabase
      .from("venue_rooms")
      .select("id")
      .eq("id", input.venue_room_id)
      .eq("venue_id", venueId)
      .maybeSingle();
    venueRoomId = (room?.id as string | undefined) ?? null;
  }

  // 4) event name — auto for unnamed weddings
  const eventTypeId = input.event_type_id;
  let typeName: string | null = null;
  if (eventTypeId) {
    const { data: t } = await supabase.from("event_types").select("name").eq("id", eventTypeId).maybeSingle();
    typeName = t?.name ?? null;
  }
  let name = input.name;
  if (!name) name = buildEventName(resolved.map((r) => r.naming), typeName) || "New Event";

  // 5) insert the event
  const packageId = input.package_id;
  const { data: event, error: evErr } = await supabase
    .from("events")
    .insert({
      name,
      event_type_id: eventTypeId,
      status_id: input.status_id,
      inquiry_source_id: inquirySourceId,
      client_id: primary?.client_id ?? null,
      event_date: input.event_date,
      setup_time: input.setup_time,
      start_time: input.start_time,
      end_time: input.end_time,
      guest_count: input.guest_count,
      venue_id: venueId,
      venue_room_id: venueRoomId,
      use_client_address: useClientAddress,
      package_id: packageId,
      package_price_override: input.package_price_override,
      deposit_value: input.deposit_value ?? 0,
      travel_fee: input.travel_fee,
      discount1_label: input.discount1_label ?? (discounts[0]?.label ?? null),
      discount1_amount: discounts[0]?.amount ?? 0,
      discount2_label: discounts[1]?.label ?? null,
      discount2_amount: discounts[1]?.amount ?? 0,
      internal_notes: input.internal_notes,
    })
    .select("id")
    .single();
  if (evErr) throw new Error(evErr.message);
  const eventId = event.id as string;
  const check = async (label: string, result: { error: { message: string } | null }) => {
    if (!options.cleanupOnError || !result.error) return;
    await supabase.from("events").delete().eq("id", eventId);
    throw new Error(`${label}: ${result.error.message}`);
  };

  // 6) event_clients
  if (resolved.length) {
    await check("Saving the clients", await supabase.from("event_clients").insert(
      resolved.map((r) => ({ event_id: eventId, client_id: r.client_id, role: r.role ?? "Client", is_primary: r.is_primary, is_contract_holder: r.is_contract_holder }))
    ));
  }

  // 7) package selection (auto add-ons/equipment + price/deposit defaults)
  if (packageId) {
    await applyPackageSelection(supabase, eventId, packageId, input.event_date, input.package_price_override !== null);
  }

  // 8) explicit add-ons on top of package defaults
  const addonRows = addons
    .filter((a) => a.addon_id)
    .map((a) => ({
      event_id: eventId,
      addon_id: a.addon_id,
      quantity: a.quantity && a.quantity > 0 ? a.quantity : 1,
      price_override: a.price_override ?? null,
    }));
  if (addonRows.length) await check("Saving the add-ons", await supabase.from("event_addons").insert(addonRows));

  // 9) contract notes (internal notes already on the event row)
  const contractNotes = input.contract_notes;
  if (contractNotes) {
    await check("Saving the note", await supabase.from("event_notes").insert({ event_id: eventId, body: contractNotes, kind: "contract" }));
  }

  // 10) custom / important dates
  const dateRows = customDates
    .filter((d) => d.definition_id && d.value)
    .map((d) => ({ event_id: eventId, definition_id: d.definition_id, value: d.value }));
  if (dateRows.length) {
    await check("Saving the dates", await supabase.from("event_custom_dates").upsert(dateRows, { onConflict: "event_id,definition_id" }));
  }

  // 11) payment schedule — full payment due OR deposit + split
  const schedulePlan = input.schedule_plan;
  if (schedulePlan) {
    const bundle = await loadEventBundle(supabase, eventId);
    const total = bundle?.total ?? 0;
    const { data: evDep } = await supabase.from("events").select("deposit_value, event_date").eq("id", eventId).single();
    const deposit = Number(evDep?.deposit_value ?? 0);
    let terms: "days_before" | "net_days_after" = "days_before";
    let termsDays = 30;
    if (packageId) {
      const { data: pkg } = await supabase
        .from("packages")
        .select("payment_terms, payment_terms_days")
        .eq("id", packageId)
        .maybeSingle();
      if (pkg) {
        terms = (pkg.payment_terms as typeof terms) ?? "days_before";
        termsDays = pkg.payment_terms_days ?? 30;
      }
    }
    const rows = buildScheduleRows({
      total,
      deposit,
      eventDate: evDep?.event_date ?? null,
      terms,
      termsDays,
      plan: schedulePlan,
      today: new Date().toISOString().slice(0, 10),
    }).map((r) => ({ ...r, event_id: eventId }));
    await check("Saving the schedule", await supabase.from("scheduled_payments").insert(rows));
  }

  // 12) staff (optional — TBD by default)
  const staffRows = staff
    .filter((s) => s.employee_id)
    .map((s) => ({ event_id: eventId, employee_id: s.employee_id, role: s.role || "DJ", flat_wage: s.flat_wage ?? 0 }));
  if (staffRows.length) await check("Saving the staff", await supabase.from("event_staff").insert(staffRows));

  // fire any "event created" automations (configured per event type)
  // Loaded here so the validation above can run without the mail stack.
  const { runAutomations } = await import("@/lib/automations");
  await runAutomations(supabase, eventId, "event_created", options.drain ? { drain: options.drain } : {});

  return eventId;
}
