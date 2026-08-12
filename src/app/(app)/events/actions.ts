"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateShortLink } from "@/lib/shortLinks";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";
import { buildScheduleRows } from "@/lib/paymentSchedule";
import { writeSchedulePreservingPaid } from "@/lib/scheduleWrite";
import { loadEventBundle } from "@/lib/documentRender";
import { buildEventName, autoNameEvent, type NamingClient } from "@/lib/eventName";
import { runAutomations, fireHelperWebhook } from "@/lib/automations";
import { dispatchNotification } from "@/lib/notify";
import { findOrCreateClient } from "@/lib/clients";
import { reseedEventPlanning, assignAddonSections } from "@/lib/planning";
import { requireModule } from "@/lib/auth";
import { inviteClientToXos } from "@/lib/accounts";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number {
  const n = parseFloat((v ?? "0").toString());
  return Number.isFinite(n) ? n : 0;
}

async function actorName(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "system";
  const { data: emp } = await supabase
    .from("employees")
    .select("first_name, last_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (emp) return `${emp.first_name} ${emp.last_name}`.trim();
  return user.email ?? "user";
}

type Tier = "master_admin" | "admin" | "salesperson" | "employee";

/** Current signed-in user's permission tier. No employee row ⇒ treated as the
    owner (master_admin), matching the dashboard's default (page.tsx). */
async function currentTier(supabase: Awaited<ReturnType<typeof createClient>>): Promise<Tier> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "employee";
  const { data: emp } = await supabase
    .from("employees")
    .select("permission_tier")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return ((emp?.permission_tier as Tier | undefined) ?? "master_admin");
}

/** Throw unless the current user holds one of the allowed tiers. */
async function requireTier(
  supabase: Awaited<ReturnType<typeof createClient>>,
  allowed: Tier[]
): Promise<void> {
  const tier = await currentTier(supabase);
  if (!allowed.includes(tier)) throw new Error("Not authorized.");
}

function eventPayload(formData: FormData) {
  return {
    name: clean(formData.get("name")) ?? "",
    client_id: clean(formData.get("client_id")),
    event_type_id: clean(formData.get("event_type_id")),
    status_id: clean(formData.get("status_id")),
    inquiry_source_id: clean(formData.get("inquiry_source_id")),
    event_date: clean(formData.get("event_date")),
    setup_time: clean(formData.get("setup_time")),
    start_time: clean(formData.get("start_time")),
    end_time: clean(formData.get("end_time")),
    guest_count: formData.get("guest_count") ? num(formData.get("guest_count")) : null,
    venue_id: clean(formData.get("venue_id")),
    package_id: clean(formData.get("package_id")),
    package_price_override: clean(formData.get("package_price_override"))
      ? num(formData.get("package_price_override"))
      : null,
    overtime_fee: num(formData.get("overtime_fee")),
    travel_fee: num(formData.get("travel_fee")),
    discount1_amount: num(formData.get("discount1_amount")),
    discount2_amount: num(formData.get("discount2_amount")),
    deposit_value: num(formData.get("deposit_value")),
    initial_contact_date: clean(formData.get("initial_contact_date")),
    contract_sent_date: clean(formData.get("contract_sent_date")),
    contract_due_date: clean(formData.get("contract_due_date")),
    contract_signed_date: clean(formData.get("contract_signed_date")),
    decision_maker_name: clean(formData.get("decision_maker_name")),
    decision_maker_phone: clean(formData.get("decision_maker_phone")),
    decision_maker_email: clean(formData.get("decision_maker_email")),
    internal_notes: clean(formData.get("internal_notes")),
    hide_financials: ((): boolean | null => {
      const v = clean(formData.get("hide_financials"));
      return v === "true" ? true : v === "false" ? false : null;
    })(),
    custom_fields: {
      gdrive_timeline: clean(formData.get("cf_gdrive_timeline")) ?? "",
      gdrive_folder: clean(formData.get("cf_gdrive_folder")) ?? "",
      vibo_link: clean(formData.get("cf_vibo_link")) ?? "",
      photobooth_gallery: clean(formData.get("cf_photobooth_gallery")) ?? "",
    },
  };
}

// Resolve the package price for a date: Custom Date Range > weekday price > default.
// Snapshot semantics (DJEP parity): applied when the package is selected; later
// package-setting changes don't reprice saved events.
async function applyPackageSelection(
  supabase: Awaited<ReturnType<typeof createClient>>,
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

export async function createEvent(formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const payload = eventPayload(formData);
  // Every event needs a billable client — downstream naming, automations, and
  // the proposal/pay flow all assume one. The tabbed onboarding path enforces a
  // primary client via its own guard; this closes the simple create path too so
  // no code path can produce an orphan (clientless) event.
  if (!payload.client_id) throw new Error("Select a client before creating the event.");
  const { data, error } = await supabase
    .from("events")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (payload.package_id) {
    await applyPackageSelection(
      supabase,
      data.id,
      payload.package_id,
      payload.event_date,
      payload.package_price_override != null
    );
  }
  revalidatePath("/events");
  redirect(`/events/${data.id}`);
}

// ---- Tabbed onboarding: build the whole event from one submit ----
type NewClient = {
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
type NewDiscount = { label?: string; amount?: number };
type NewAddon = { addon_id: string; quantity?: number; price_override?: number | null };
type NewStaff = { employee_id: string; role?: string; flat_wage?: number };
type NewDate = { definition_id: string; value?: string };
type NewVenue = {
  name?: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
  place_id?: string | null;
};

function parseJson<T>(v: FormDataEntryValue | null, fallback: T): T {
  try {
    const s = (v ?? "").toString();
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

/* Reference data the New Event form needs — fetched on demand so the form can
   open in a modal from anywhere (mirrors what /events/new loads server-side). */
export async function loadNewEventFormData() {
  await requireModule("events", "view", { mode: "throw" });
  const supabase = await createClient();
  const [
    { data: roles },
    { data: types },
    { data: statuses },
    { data: sources },
    { data: packages },
    { data: addons },
    { data: employees },
    { data: dateDefs },
  ] = await Promise.all([
    supabase.from("client_role_definitions").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("event_statuses").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("inquiry_sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("packages").select("id, name, default_price, deposit_value, allowed_splits").eq("is_active", true).order("display_order"),
    supabase.from("addons").select("id, name, default_price").eq("is_active", true).order("display_order"),
    supabase.from("employees").select("id, first_name, last_name").eq("is_active", true).order("first_name"),
    supabase.from("custom_date_definitions").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  return {
    roles: (roles ?? []) as { id: string; name: string }[],
    eventTypes: (types ?? []) as { id: string; name: string }[],
    statuses: (statuses ?? []) as { id: string; name: string }[],
    inquirySources: (sources ?? []) as { id: string; name: string }[],
    packages: (packages ?? []) as { id: string; name: string; default_price: number; deposit_value: number; allowed_splits: number[] | null }[],
    addons: (addons ?? []) as { id: string; name: string; default_price: number }[],
    employees: (employees ?? []) as { id: string; first_name: string; last_name: string }[],
    customDateDefs: (dateDefs ?? []) as { id: string; name: string }[],
  };
}

export async function createEventOnboarding(formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();

  const clients = parseJson<NewClient[]>(formData.get("clients_json"), []);

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

  const discounts = parseJson<NewDiscount[]>(formData.get("discounts_json"), []);
  const addons = parseJson<NewAddon[]>(formData.get("addons_json"), []);
  const staff = parseJson<NewStaff[]>(formData.get("staff_json"), []);
  const customDates = parseJson<NewDate[]>(formData.get("custom_dates_json"), []);
  const newVenue = parseJson<NewVenue | null>(formData.get("new_venue_json"), null);

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
  let inquirySourceId = clean(formData.get("inquiry_source_id"));
  const newSourceName = clean(formData.get("new_source_name"));
  if (!inquirySourceId && newSourceName) {
    const persist = formData.get("new_source_persist") === "true" || formData.get("new_source_persist") === "on";
    const { data: src } = await supabase
      .from("inquiry_sources")
      .insert({ name: newSourceName, is_active: persist })
      .select("id")
      .single();
    inquirySourceId = src?.id ?? null;
  }

  // 3) resolve venue (existing, newly-created-from-Google, or client address)
  const useClientAddress = formData.get("use_client_address") === "true" || formData.get("use_client_address") === "on";
  let venueId = clean(formData.get("venue_id"));
  if (useClientAddress) {
    venueId = null;
    const addr = clean(formData.get("client_address"));
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

  // 4) event name — auto for unnamed weddings
  const eventTypeId = clean(formData.get("event_type_id"));
  let typeName: string | null = null;
  if (eventTypeId) {
    const { data: t } = await supabase.from("event_types").select("name").eq("id", eventTypeId).maybeSingle();
    typeName = t?.name ?? null;
  }
  let name = clean(formData.get("name"));
  if (!name) name = buildEventName(resolved.map((r) => r.naming), typeName) || "New Event";

  // 5) insert the event
  const depositInput = clean(formData.get("deposit_value"));
  const priceOverride = clean(formData.get("package_price_override"));
  const packageId = clean(formData.get("package_id"));
  const { data: event, error: evErr } = await supabase
    .from("events")
    .insert({
      name,
      event_type_id: eventTypeId,
      status_id: clean(formData.get("status_id")),
      inquiry_source_id: inquirySourceId,
      client_id: primary?.client_id ?? null,
      event_date: clean(formData.get("event_date")),
      setup_time: clean(formData.get("setup_time")),
      start_time: clean(formData.get("start_time")),
      end_time: clean(formData.get("end_time")),
      guest_count: formData.get("guest_count") ? num(formData.get("guest_count")) : null,
      venue_id: venueId,
      venue_room_id: clean(formData.get("venue_room_id")),
      use_client_address: useClientAddress,
      package_id: packageId,
      package_price_override: priceOverride ? num(formData.get("package_price_override")) : null,
      deposit_value: depositInput ? num(formData.get("deposit_value")) : 0,
      travel_fee: num(formData.get("travel_fee")),
      discount1_label: clean(formData.get("d1l")) ?? (discounts[0]?.label ?? null),
      discount1_amount: discounts[0]?.amount ?? 0,
      discount2_label: discounts[1]?.label ?? null,
      discount2_amount: discounts[1]?.amount ?? 0,
      internal_notes: clean(formData.get("internal_notes")),
    })
    .select("id")
    .single();
  if (evErr) throw new Error(evErr.message);
  const eventId = event.id as string;

  // 6) event_clients
  if (resolved.length) {
    await supabase.from("event_clients").insert(
      resolved.map((r) => ({ event_id: eventId, client_id: r.client_id, role: r.role ?? "Client", is_primary: r.is_primary, is_contract_holder: r.is_contract_holder }))
    );
  }

  // 7) package selection (auto add-ons/equipment + price/deposit defaults)
  if (packageId) {
    await applyPackageSelection(supabase, eventId, packageId, clean(formData.get("event_date")), !!priceOverride);
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
  if (addonRows.length) await supabase.from("event_addons").insert(addonRows);

  // 9) contract notes (internal notes already on the event row)
  const contractNotes = clean(formData.get("contract_notes"));
  if (contractNotes) {
    await supabase.from("event_notes").insert({ event_id: eventId, body: contractNotes, kind: "contract" });
  }

  // 10) custom / important dates
  const dateRows = customDates
    .filter((d) => d.definition_id && d.value)
    .map((d) => ({ event_id: eventId, definition_id: d.definition_id, value: d.value }));
  if (dateRows.length) {
    await supabase.from("event_custom_dates").upsert(dateRows, { onConflict: "event_id,definition_id" });
  }

  // 11) payment schedule (deposit + split) — generated from current totals
  const scheduleCount = formData.get("schedule_count") ? Math.max(1, Math.round(num(formData.get("schedule_count")))) : 0;
  if (scheduleCount > 0) {
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
      plan: { kind: "split", count: scheduleCount },
      today: new Date().toISOString().slice(0, 10),
    }).map((r) => ({ ...r, event_id: eventId }));
    await supabase.from("scheduled_payments").insert(rows);
  }

  // 12) staff (optional — TBD by default)
  const staffRows = staff
    .filter((s) => s.employee_id)
    .map((s) => ({ event_id: eventId, employee_id: s.employee_id, role: s.role || "DJ", flat_wage: s.flat_wage ?? 0 }));
  if (staffRows.length) await supabase.from("event_staff").insert(staffRows);

  // fire any "event created" automations (configured per event type)
  await runAutomations(supabase, eventId, "event_created");

  revalidatePath("/events");
  redirect(`/events/${eventId}`);
}

export async function updateEvent(id: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("events")
    .select("package_id")
    .eq("id", id)
    .single();
  const payload = eventPayload(formData);
  const { error } = await supabase.from("events").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  if (payload.package_id && payload.package_id !== before?.package_id) {
    await applyPackageSelection(
      supabase,
      id,
      payload.package_id,
      payload.event_date,
      payload.package_price_override != null
    );
  }
  revalidatePath(`/events/${id}`);
  revalidatePath("/events");
  redirect(`/events/${id}`);
}

export async function setEventStatus(id: string, statusId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("events").update({ status_id: statusId }).eq("id", id);
  if (error) throw new Error(error.message);
  await runAutomations(supabase, id, "status_changed", { statusId });
  revalidatePath(`/events/${id}`);
  revalidatePath("/events");
}

export async function addPayment(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  // num() coerces empty/non-numeric input to 0 and passes negatives through, so
  // guard explicitly: a payment must be a real, positive amount. !(amount > 0)
  // rejects 0, negatives, and NaN in one check. (The DB CHECK backstops every
  // insert path; this gives staff a clear message.)
  const amount = num(formData.get("amount"));
  if (!(amount > 0)) throw new Error("Enter a payment amount greater than $0.");
  const { error } = await supabase.from("payments").insert({
    event_id: eventId,
    amount,
    method: clean(formData.get("method")) ?? "other",
    reason: clean(formData.get("reason")),
    paid_at: clean(formData.get("paid_at")) ?? new Date().toISOString(),
    notes: clean(formData.get("notes")),
  });
  if (error) throw new Error(error.message);
  await runAutomations(supabase, eventId, "payment_received");
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/payments");
}

/* Confirm a pending payment (e.g. a client-reported Zelle claim) once the money
   has actually landed: flip it to approved, link it to the earliest unpaid
   scheduled payment, and fire payment_received automations. */
export async function confirmPayment(paymentId: string, eventId: string, formData?: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const note = formData ? clean(formData.get("note")) : null;

  // A pending claim only counts toward the balance once approved, so verify it's
  // a real positive amount before it enters the ledger (defense in depth).
  const { data: pending } = await supabase
    .from("payments")
    .select("amount")
    .eq("id", paymentId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!pending) throw new Error("Payment not found.");
  if (!(Number(pending.amount) > 0)) throw new Error("This payment's amount is invalid — remove it and re-enter.");

  // link to the earliest scheduled payment with no approved payment against it
  const [{ data: scheduled }, { data: priorPayments }] = await Promise.all([
    supabase.from("scheduled_payments").select("id, seq").eq("event_id", eventId).order("seq"),
    supabase
      .from("payments")
      .select("scheduled_payment_id")
      .eq("event_id", eventId)
      .eq("status", "approved")
      .is("deleted_at", null),
  ]);
  const taken = new Set((priorPayments ?? []).map((p) => p.scheduled_payment_id).filter(Boolean));
  const scheduledId = (scheduled ?? []).find((s) => !taken.has(s.id))?.id ?? null;

  const patch: Record<string, unknown> = { status: "approved", scheduled_payment_id: scheduledId, paid_at: new Date().toISOString() };
  if (note) patch.notes = note; // staff-entered Zelle details replace the auto reminder
  const { error } = await supabase
    .from("payments")
    .update(patch)
    .eq("id", paymentId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);

  await runAutomations(supabase, eventId, "payment_received");
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/payments");
}

/* Remove a payment row — used to reject a false/duplicate Zelle claim, or undo
   a mistaken entry. SOFT delete: stamps deleted_at/deleted_by so it stops counting
   toward the balance immediately but can be restored from the "Recently removed"
   list (money records must be recoverable, never hard-deleted). */
export async function removePayment(paymentId: string, eventId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: emp } = user
    ? await supabase.from("employees").select("first_name, last_name, stage_name").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };
  const by = emp
    ? emp.stage_name || `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || null
    : user?.email ?? null;

  const { error } = await supabase
    .from("payments")
    .update({ deleted_at: new Date().toISOString(), deleted_by: by })
    .eq("id", paymentId)
    .eq("event_id", eventId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/payments");
}

/* Restore a soft-deleted payment from the "Recently removed" list. */
export async function restorePayment(paymentId: string, eventId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("payments")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", paymentId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/payments");
}

/* Mint (or reuse) a short link for this event's proposal — a tidy
   xos.xpressdjs.com/p/<code> URL that redirects to /proposal/<pay_token>, for
   staff to copy and send to a client. */
export async function getProposalShortLink(eventId: string): Promise<{ url: string } | { error: string }> {
  await requireModule("events", "view", { mode: "throw" });
  const admin = createAdminClient();
  const { data: ev } = await admin.from("events").select("pay_token").eq("id", eventId).maybeSingle();
  if (!ev?.pay_token) return { error: "This event has no proposal link yet." };
  try {
    const url = await getOrCreateShortLink(admin, {
      eventId,
      kind: "proposal",
      // Land on the email-content cover page, which then continues into /proposal.
      targetPath: `/offer/${ev.pay_token}`,
    });
    return { url };
  } catch {
    return { error: "Couldn't generate the link — please try again." };
  }
}

export async function addScheduledPayments(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  // schedule generation governed by the package's payment rules:
  // allowed splits + final-due terms (N days before event, or corporate Net-N after)
  const count = Math.max(1, Math.round(num(formData.get("count"))));
  const total = num(formData.get("total"));
  const deposit = num(formData.get("deposit"));
  const eventDate = clean(formData.get("event_date"));

  const { data: event } = await supabase
    .from("events")
    .select("package_id")
    .eq("id", eventId)
    .single();
  let terms: "days_before" | "net_days_after" = "days_before";
  let termsDays = 30;
  let allowedSplits: number[] = [1, 2, 3];
  if (event?.package_id) {
    const { data: pkg } = await supabase
      .from("packages")
      .select("payment_terms, payment_terms_days, allowed_splits")
      .eq("id", event.package_id)
      .single();
    if (pkg) {
      terms = (pkg.payment_terms as typeof terms) ?? "days_before";
      termsDays = pkg.payment_terms_days ?? 30;
      allowedSplits = pkg.allowed_splits?.length ? pkg.allowed_splits : [1, 2, 3];
    }
  }
  if (!allowedSplits.includes(count)) {
    throw new Error(`This package allows ${allowedSplits.join(", ")} payment split(s) — ${count} is not permitted.`);
  }

  // Preserve already-paid installments (and their payment links); only the
  // unpaid portion is regenerated to cover the remaining balance.
  await writeSchedulePreservingPaid(supabase, eventId, {
    total,
    deposit,
    eventDate: eventDate ?? null,
    terms,
    termsDays,
    plan: { kind: "split", count },
  });
  revalidatePath(`/events/${eventId}`);
}

/** Office-set billing terms for event types where the office (not the client)
    decides the plan. Read by the public /proposal page when chooser = 'office'. */
export async function updateBillingTerms(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const terms = clean(formData.get("billing_terms"));
  const count = Math.max(1, Math.round(num(formData.get("billing_terms_count"))) || 2);
  const { error } = await supabase
    .from("events")
    .update({ billing_terms: terms, billing_terms_count: count })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function runBookingHelper(eventId: string, helperId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  // SECURITY DEFINER — service-role client so a signed-in client/guest can't call
  // run_booking_helper directly (authenticated EXECUTE revoked, migration 00166).
  // Staff access is already gated by requireModule above.
  const admin = createAdminClient();
  const { error } = await admin.rpc("run_booking_helper", {
    p_helper_id: helperId,
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  // fire this helper's webhook too (so a manual click can test the Zap)
  await fireHelperWebhook(admin, helperId, eventId);
  // deliver anything the helper queued right away (attachments/sign links
  // are handled at send time) instead of waiting for the 10-minute cron
  await processOutbox();
  await processSmsOutbox();
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

export async function assignStaff(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const employeeId = clean(formData.get("employee_id"));
  if (!employeeId) return;
  const { error } = await supabase.from("event_staff").insert({
    event_id: eventId,
    employee_id: employeeId,
    role: clean(formData.get("role")) ?? "DJ",
    flat_wage: num(formData.get("flat_wage")),
  });
  if (error) throw new Error(error.message);
  await dispatchNotification(supabase, "staff_assigned", { eventId, employeeIds: [employeeId] });
  revalidatePath(`/events/${eventId}`);
}

export async function removeStaff(eventId: string, staffId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("event_staff").delete().eq("id", staffId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function markStaff(
  eventId: string,
  staffId: string,
  field: "notified_at" | "confirmed_at" | "checked_in_at" | "checked_out_at"
) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_staff")
    .update({ [field]: new Date().toISOString() })
    .eq("id", staffId);
  if (error) throw new Error(error.message);
  if (field === "confirmed_at") await dispatchNotification(supabase, "staff_confirmed", { eventId });
  revalidatePath(`/events/${eventId}`);
}

/* Staff self-service: a signed-in employee checks themselves in/out of their own
   assignment (verified by auth_user_id → employee_id → event_staff.employee_id). */
export async function selfCheckInOut(eventStaffId: string, field: "checked_in_at" | "checked_out_at") {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: emp } = await supabase.from("employees").select("id").eq("auth_user_id", user.id).maybeSingle();
  const { data: row } = await supabase.from("event_staff").select("id, employee_id").eq("id", eventStaffId).maybeSingle();
  if (!emp || !row || row.employee_id !== emp.id) throw new Error("Not authorized.");
  const { error } = await supabase.from("event_staff").update({ [field]: new Date().toISOString() }).eq("id", eventStaffId);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

/* Staff request a correction to their recorded times — admins approve on /payroll. */
export async function requestTimesheetChange(eventStaffId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: emp } = await supabase.from("employees").select("id").eq("auth_user_id", user.id).maybeSingle();
  const { data: row } = await supabase.from("event_staff").select("id, employee_id").eq("id", eventStaffId).maybeSingle();
  if (!emp || !row || row.employee_id !== emp.id) throw new Error("Not authorized.");
  const ci = clean(formData.get("check_in"));
  const co = clean(formData.get("check_out"));
  const { error } = await supabase.from("timesheet_change_requests").insert({
    event_staff_id: eventStaffId,
    requested_check_in: ci ? new Date(ci).toISOString() : null,
    requested_check_out: co ? new Date(co).toISOString() : null,
    reason: clean(formData.get("reason")),
  });
  if (error) throw new Error(error.message);
  await dispatchNotification(supabase, "timesheet_submitted", {});
  revalidatePath("/");
}

export async function addEventEquipment(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const ref = clean(formData.get("equipment_ref")); // "item:<id>" or "system:<id>"
  if (!ref) return;
  const [kind, refId] = ref.split(":");
  const { error } = await supabase.from("event_equipment").insert({
    event_id: eventId,
    item_id: kind === "item" ? refId : null,
    system_id: kind === "system" ? refId : null,
    quantity: Math.max(1, Math.round(num(formData.get("quantity")) || 1)),
    notes: clean(formData.get("notes")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function removeEventEquipment(eventId: string, rowId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("event_equipment").delete().eq("id", rowId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function toggleEquipmentPacked(eventId: string, rowId: string, packed: boolean) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("event_equipment").update({ packed }).eq("id", rowId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function markEquipment(
  eventId: string,
  rowId: string,
  field: "checked_out_at" | "checked_in_at"
) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_equipment")
    .update({ [field]: new Date().toISOString() })
    .eq("id", rowId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function updateEquipmentNotes(eventId: string, rowId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_equipment")
    .update({ notes: clean(formData.get("notes")) })
    .eq("id", rowId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addLogisticsNote(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const body = clean(formData.get("body"));
  if (!body) return;
  const { error } = await supabase.from("event_notes").insert({
    event_id: eventId,
    body,
    kind: "logistics",
    author_name: await actorName(supabase),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

// ─────────────────────── Event files (uploads + labels) ───────────────────────

const MAX_UPLOAD = 50 * 1024 * 1024; // 50 MB (project storage limit)

/** Upload a file to the event's private files, optionally labeled. Music, photos,
    PDFs — anything. Stored in the `event-files` bucket via the admin client. */
export async function uploadEventFile(eventId: string, _prev: unknown, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false as const, error: "Choose a file first." };
  if (file.size > MAX_UPLOAD) return { ok: false as const, error: "File is too large (max 50MB)." };
  const labelId = clean(formData.get("label_id"));

  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "bin";
  const path = `${eventId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("event-files")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: true });
  if (upErr) return { ok: false as const, error: upErr.message };

  const { error } = await admin.from("event_files").insert({
    event_id: eventId,
    name: file.name || `File.${ext}`,
    path,
    content_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    source: "upload",
    label_id: labelId,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/events/${eventId}`);
  return { ok: true as const };
}

/** Change (or clear) a file's label. */
export async function setEventFileLabel(eventId: string, fileId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const admin = createAdminClient();
  const { error } = await admin
    .from("event_files")
    .update({ label_id: clean(formData.get("label_id")) })
    .eq("id", fileId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

/** Remove a file (storage object + row). */
export async function deleteEventFile(eventId: string, fileId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const admin = createAdminClient();
  const { data: f } = await admin.from("event_files").select("path").eq("id", fileId).eq("event_id", eventId).maybeSingle();
  if (f?.path) await admin.storage.from("event-files").remove([f.path]);
  const { error } = await admin.from("event_files").delete().eq("id", fileId).eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addEventVendor(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const vendorId = clean(formData.get("vendor_id"));
  if (!vendorId) return;
  const { error } = await supabase.from("event_vendors").insert({
    event_id: eventId,
    vendor_id: vendorId,
    role: clean(formData.get("role")) ?? "Vendor",
    notes: clean(formData.get("notes")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function removeEventVendor(eventId: string, eventVendorId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("event_vendors").delete().eq("id", eventVendorId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function updateStaffDetails(eventId: string, staffId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_staff")
    .update({
      role: clean(formData.get("role")) ?? "DJ",
      flat_wage: num(formData.get("flat_wage")),
      start_time: clean(formData.get("start_time")),
      end_time: clean(formData.get("end_time")),
      notes: clean(formData.get("notes")),
    })
    .eq("id", staffId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function toggleStaffPortal(eventId: string, staffId: string, visible: boolean) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_staff")
    .update({ portal_visible: visible })
    .eq("id", staffId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function deleteEvent(eventId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  // hard delete is master_admin only — everyone else archives instead
  await requireTier(supabase, ["master_admin"]);

  // Never orphan money history. payments.event_id is ON DELETE SET NULL, so a hard
  // delete would strand every payment row (event link gone → unattributable, drops
  // out of all per-event views). If the event has ANY payment record — approved,
  // pending, or already soft-deleted — refuse the delete and steer to archive,
  // which hides the event and stops automations while keeping the money records
  // attributable. Count via the service-role client so RLS can't hide rows and let
  // the guard fail open.
  const admin = createAdminClient();
  const { count: payCount } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  if ((payCount ?? 0) > 0) {
    throw new Error(
      "This event has payment history and can't be permanently deleted — that would orphan its payment records. Archive it instead: it'll be hidden and all automations stop, but the money records stay attributable.",
    );
  }

  const { error } = await supabase.from("events").delete().eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/events");
  redirect("/events");
}

/* Archive an event: keep its data but mark it archived, which stops all
   automations (runAutomations no-ops on archived events) and drops it out of
   the active Events list / dashboard. Also cancels any still-queued automated
   emails/SMS so nothing already in the outbox fires. */
export async function archiveEvent(eventId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  await requireTier(supabase, ["master_admin", "admin", "salesperson"]);

  const { error } = await supabase
    .from("events")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) throw new Error(error.message);

  // stop anything already queued by automations from sending
  await supabase.from("email_log").update({ status: "cancelled" }).eq("event_id", eventId).eq("status", "queued");
  await supabase.from("sms_log").update({ status: "cancelled" }).eq("event_id", eventId).eq("status", "queued");

  await supabase.from("event_logs").insert({ event_id: eventId, actor: await actorName(supabase), action: "Event archived" });

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  redirect("/events");
}

export async function unarchiveEvent(eventId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  await requireTier(supabase, ["master_admin", "admin", "salesperson"]);

  const { error } = await supabase.from("events").update({ archived_at: null }).eq("id", eventId);
  if (error) throw new Error(error.message);

  await supabase.from("event_logs").insert({ event_id: eventId, actor: await actorName(supabase), action: "Event unarchived" });

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

export async function addEventClient(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const clientId = clean(formData.get("client_id"));
  if (!clientId) return;
  const { count } = await supabase
    .from("event_clients")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  const isFirst = (count ?? 0) === 0;
  const { error } = await supabase.from("event_clients").insert({
    event_id: eventId,
    client_id: clientId,
    role: clean(formData.get("role")) ?? "Client",
    is_primary: isFirst,
  });
  if (error) throw new Error(error.message);
  if (isFirst) {
    await supabase.from("events").update({ client_id: clientId }).eq("id", eventId);
  }
  await autoNameEvent(supabase, eventId);
  revalidatePath(`/events/${eventId}`);
}

export async function createClientAndAttach(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const firstName = clean(formData.get("first_name"));
  if (!firstName) return;
  // dedupe by email — reuse an existing client instead of creating a twin
  const found = await findOrCreateClient(supabase, {
    first_name: firstName,
    last_name: clean(formData.get("last_name")) ?? "",
    cell_phone: clean(formData.get("cell_phone")),
    email: clean(formData.get("email")),
  });

  const { count } = await supabase
    .from("event_clients")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  const isFirst = (count ?? 0) === 0;

  const { error } = await supabase.from("event_clients").insert({
    event_id: eventId,
    client_id: found.id,
    role: clean(formData.get("role")) ?? "Client",
    is_primary: isFirst,
  });
  if (error) throw new Error(error.message);
  if (isFirst) {
    await supabase.from("events").update({ client_id: found.id }).eq("id", eventId);
  }
  await autoNameEvent(supabase, eventId);
  revalidatePath(`/events/${eventId}`);
}

export async function removeEventClient(eventId: string, eventClientId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: links } = await supabase
    .from("event_clients")
    .select("id, client_id, is_primary")
    .eq("event_id", eventId);
  if ((links ?? []).length <= 1) {
    throw new Error("An event must always have at least one client.");
  }
  const removed = (links ?? []).find((l) => l.id === eventClientId);
  const { error } = await supabase.from("event_clients").delete().eq("id", eventClientId);
  if (error) throw new Error(error.message);
  if (removed?.is_primary) {
    // promote the next client to primary / contract holder
    const next = (links ?? []).find((l) => l.id !== eventClientId)!;
    await supabase.from("event_clients").update({ is_primary: true }).eq("id", next.id);
    await supabase.from("events").update({ client_id: next.client_id }).eq("id", eventId);
  }
  revalidatePath(`/events/${eventId}`);
}

export async function setPrimaryEventClient(eventId: string, eventClientId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: link } = await supabase
    .from("event_clients")
    .select("client_id")
    .eq("id", eventClientId)
    .single();
  if (!link) return;
  await supabase.from("event_clients").update({ is_primary: false }).eq("event_id", eventId);
  await supabase.from("event_clients").update({ is_primary: true }).eq("id", eventClientId);
  await supabase.from("events").update({ client_id: link.client_id }).eq("id", eventId);
  revalidatePath(`/events/${eventId}`);
}

export async function toggleContractHolder(eventId: string, eventClientId: string, value: boolean) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("event_clients").update({ is_contract_holder: value }).eq("id", eventClientId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

/** "Invite to XOS": onboard this event's client to the planning portal — creates
    their login if needed and emails the editable Client Invite template with a
    set/reset-password link. */
export async function inviteEventClientToXos(eventId: string, clientId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireModule("events", "edit", { mode: "throw", supabase });
  const { data: c } = await supabase.from("clients").select("email, first_name").eq("id", clientId).maybeSingle();
  if (!c?.email) return { ok: false, error: "Add an email to this client first." };
  const res = await inviteClientToXos({ clientId, eventId, email: c.email, name: c.first_name });
  if (res.ok) revalidatePath(`/events/${eventId}`);
  return res;
}

export async function addClientNote(eventId: string, clientId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const body = clean(formData.get("body"));
  if (!body) return;
  const { error } = await supabase.from("client_notes").insert({
    client_id: clientId,
    body,
    author_name: await actorName(supabase),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/clients/${clientId}`);
}

async function assignAddonEquipment(
  supabase: Awaited<ReturnType<typeof createClient>>,
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

export async function addEventAddon(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const addonId = clean(formData.get("addon_id"));
  if (!addonId) return;
  // only store an override when the price actually differs from the catalog default
  let priceOverride: number | null = null;
  if (clean(formData.get("price_override"))) {
    const entered = num(formData.get("price_override"));
    const { data: addon } = await supabase.from("addons").select("default_price").eq("id", addonId).single();
    if (!addon || Number(addon.default_price) !== entered) priceOverride = entered;
  }
  const { error } = await supabase.from("event_addons").insert({
    event_id: eventId,
    addon_id: addonId,
    quantity: Math.max(1, Math.round(num(formData.get("quantity")) || 1)),
    price_override: priceOverride,
  });
  if (error) throw new Error(error.message);
  await assignAddonEquipment(supabase, eventId, addonId);
  await assignAddonSections(eventId, addonId);
  revalidatePath(`/events/${eventId}`);
}

export async function removeEventAddon(eventId: string, eventAddonId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("event_addons").delete().eq("id", eventAddonId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addExpense(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  let categoryId = clean(formData.get("category_id"));
  const newCategory = clean(formData.get("new_category"));
  if (newCategory) {
    const { data: cat, error: catError } = await supabase
      .from("expense_categories")
      .upsert({ name: newCategory }, { onConflict: "name" })
      .select("id")
      .single();
    if (catError) throw new Error(catError.message);
    categoryId = cat.id;
  }
  const { error } = await supabase.from("expenses").insert({
    event_id: eventId,
    category_id: categoryId,
    payee: clean(formData.get("payee")),
    payment_method: clean(formData.get("payment_method")),
    description: clean(formData.get("description")),
    amount: num(formData.get("amount")),
    expense_date: clean(formData.get("expense_date")) ?? undefined,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function deleteExpense(eventId: string, expenseId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addTrip(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  let vehicleId: string | null = null;
  const vehicleName = clean(formData.get("vehicle"));
  if (vehicleName) {
    const { data: v, error: vError } = await supabase
      .from("vehicles")
      .upsert({ name: vehicleName }, { onConflict: "name" })
      .select("id")
      .single();
    if (vError) throw new Error(vError.message);
    vehicleId = v.id;
  }
  const { error } = await supabase.from("event_trips").insert({
    event_id: eventId,
    vehicle_id: vehicleId,
    trip_date: clean(formData.get("trip_date")) ?? undefined,
    miles: num(formData.get("miles")),
    notes: clean(formData.get("notes")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function deleteTrip(eventId: string, tripId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("event_trips").delete().eq("id", tripId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addEventNote(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const body = clean(formData.get("body"));
  if (!body) return;
  const { error } = await supabase.from("event_notes").insert({
    event_id: eventId,
    body,
    kind: "internal",
    author_name: await actorName(supabase),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addContractNote(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const body = clean(formData.get("body"));
  if (!body) return;
  const { error } = await supabase.from("event_notes").insert({
    event_id: eventId,
    body,
    kind: "contract",
    author_name: await actorName(supabase),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function updateEventNote(eventId: string, noteId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const body = clean(formData.get("body"));
  if (!body) return;
  const { error } = await supabase
    .from("event_notes")
    .update({ body })
    .eq("id", noteId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function deleteEventNote(eventId: string, noteId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_notes")
    .delete()
    .eq("id", noteId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function updateEventDetails(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({
      name: clean(formData.get("name")) ?? "",
      event_type_id: clean(formData.get("event_type_id")),
      event_date: clean(formData.get("event_date")),
      setup_time: clean(formData.get("setup_time")),
      start_time: clean(formData.get("start_time")),
      end_time: clean(formData.get("end_time")),
      guest_count: formData.get("guest_count") ? num(formData.get("guest_count")) : null,
    })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

export async function updateEventVenue(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  let venueId = clean(formData.get("venue_id"));

  // "Create New Venue" from Google → make the venue, then attach it
  const nv = parseJson<{
    name?: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    lat?: number | null;
    lng?: number | null;
    place_id?: string | null;
  } | null>(formData.get("new_venue_json"), null);
  if (!venueId && nv?.name) {
    const { data: v, error: vErr } = await supabase
      .from("venues")
      .insert({
        name: nv.name,
        address: nv.address ?? null,
        city: nv.city ?? null,
        state: nv.state ?? null,
        zip: nv.zip ?? null,
        lat: nv.lat ?? null,
        lng: nv.lng ?? null,
        google_place_id: nv.place_id ?? null,
      })
      .select("id")
      .single();
    if (vErr) throw new Error(vErr.message);
    venueId = v.id;
  }

  const { error } = await supabase
    .from("events")
    .update({ venue_id: venueId, venue_room_id: clean(formData.get("venue_room_id")) })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

export async function updateEventLinks(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("custom_fields")
    .eq("id", eventId)
    .single();
  const cf = { ...((event?.custom_fields as Record<string, string>) ?? {}) };
  cf.vibo_link = clean(formData.get("vibo_link")) ?? "";
  cf.gdrive_timeline = clean(formData.get("gdrive_timeline")) ?? "";
  cf.gdrive_folder = clean(formData.get("gdrive_folder")) ?? "";
  cf.photobooth_gallery = clean(formData.get("photobooth_gallery")) ?? "";
  const { error } = await supabase.from("events").update({ custom_fields: cf }).eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

/** Assign / switch the XOS Planner template for an event. Picking a template
    RE-SEEDS the planner from it (clears the event's current planner sections). */
export async function setEventPlanningTemplate(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const templateId = clean(formData.get("planning_template_id"));
  const supabase = await createClient();
  if (!templateId) {
    await supabase.from("events").update({ planning_template_id: null }).eq("id", eventId);
  } else {
    await reseedEventPlanning(eventId, templateId);
  }
  revalidatePath(`/events/${eventId}`);
}

export async function updateEventFinancials(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("events")
    .select("package_id, event_date")
    .eq("id", eventId)
    .single();
  const newPackageId = clean(formData.get("package_id"));
  const overrideSubmitted = clean(formData.get("package_price_override")) != null;

  const { error } = await supabase
    .from("events")
    .update({
      package_id: newPackageId,
      package_price_override: overrideSubmitted ? num(formData.get("package_price_override")) : null,
      deposit_value: num(formData.get("deposit_value")),
      overtime_fee: num(formData.get("overtime_fee")),
      travel_fee: num(formData.get("travel_fee")),
      discount1_amount: num(formData.get("discount1_amount")),
      discount2_amount: num(formData.get("discount2_amount")),
    })
    .eq("id", eventId);
  if (error) throw new Error(error.message);

  // package newly selected or changed → apply date-aware pricing + package defaults
  if (newPackageId && newPackageId !== before?.package_id) {
    await applyPackageSelection(supabase, eventId, newPackageId, before?.event_date ?? null, overrideSubmitted);
  }
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

export async function updateBookingInfo(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: before } = await supabase.from("events").select("status_id").eq("id", eventId).maybeSingle();
  const statusId = clean(formData.get("status_id"));
  const { error } = await supabase
    .from("events")
    .update({
      status_id: statusId,
      inquiry_source_id: clean(formData.get("inquiry_source_id")),
      salesperson_id: clean(formData.get("salesperson_id")),
      point_of_contact_employee_id: clean(formData.get("point_of_contact_employee_id")),
    })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  if (statusId && statusId !== before?.status_id) {
    await runAutomations(supabase, eventId, "status_changed", { statusId });
  }
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

export async function updateBookingDates(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({
      initial_contact_date: clean(formData.get("initial_contact_date")),
      contract_sent_date: clean(formData.get("contract_sent_date")),
      contract_due_date: clean(formData.get("contract_due_date")),
      booked_date: clean(formData.get("booked_date")),
    })
    .eq("id", eventId);
  if (error) throw new Error(error.message);

  // custom date fields arrive as custom_<definitionId>
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("custom_")) continue;
    const definitionId = key.slice(7);
    const value = (raw ?? "").toString().trim();
    if (value === "") {
      await supabase
        .from("event_custom_dates")
        .delete()
        .eq("event_id", eventId)
        .eq("definition_id", definitionId);
    } else {
      await supabase
        .from("event_custom_dates")
        .upsert(
          { event_id: eventId, definition_id: definitionId, value },
          { onConflict: "event_id,definition_id" }
        );
    }
  }
  revalidatePath(`/events/${eventId}`);
}

export async function addCustomDateField(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("custom_date_definitions").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}
