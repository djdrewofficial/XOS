"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";
import { buildScheduleRows } from "@/lib/paymentSchedule";
import { loadEventBundle } from "@/lib/documentRender";
import { buildEventName, autoNameEvent, type NamingClient } from "@/lib/eventName";
import { runAutomations, fireHelperWebhook } from "@/lib/automations";

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
    internal_notes: clean(formData.get("internal_notes")),
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
  const supabase = await createClient();
  const payload = eventPayload(formData);
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

export async function createEventOnboarding(formData: FormData) {
  const supabase = await createClient();

  const clients = parseJson<NewClient[]>(formData.get("clients_json"), []);
  const discounts = parseJson<NewDiscount[]>(formData.get("discounts_json"), []);
  const addons = parseJson<NewAddon[]>(formData.get("addons_json"), []);
  const staff = parseJson<NewStaff[]>(formData.get("staff_json"), []);
  const customDates = parseJson<NewDate[]>(formData.get("custom_dates_json"), []);
  const newVenue = parseJson<NewVenue | null>(formData.get("new_venue_json"), null);

  // 1) resolve clients (create the new ones) and figure out the primary
  const resolved: { client_id: string; role: string | null; is_primary: boolean; naming: NamingClient }[] = [];
  for (const c of clients) {
    let id = c.client_id ?? null;
    let first = c.first_name ?? "";
    let last = c.last_name ?? "";
    if (c.mode === "new" || !id) {
      if (!first && !c.email && !c.cell_phone) continue; // skip empty rows
      const { data: created, error } = await supabase
        .from("clients")
        .insert({ first_name: first || "Client", last_name: last, email: c.email ?? null, cell_phone: c.cell_phone ?? null })
        .select("id, first_name, last_name")
        .single();
      if (error) throw new Error(error.message);
      id = created.id;
      first = created.first_name;
      last = created.last_name;
    } else {
      const { data: existing } = await supabase.from("clients").select("first_name, last_name").eq("id", id).maybeSingle();
      first = existing?.first_name ?? first;
      last = existing?.last_name ?? last;
    }
    resolved.push({
      client_id: id!,
      role: c.role ?? null,
      is_primary: !!c.is_primary,
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
      resolved.map((r) => ({ event_id: eventId, client_id: r.client_id, role: r.role ?? "Client", is_primary: r.is_primary }))
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
  const supabase = await createClient();
  const { error } = await supabase.from("events").update({ status_id: statusId }).eq("id", id);
  if (error) throw new Error(error.message);
  await runAutomations(supabase, id, "status_changed", { statusId });
  revalidatePath(`/events/${id}`);
  revalidatePath("/events");
}

export async function addPayment(eventId: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({
    event_id: eventId,
    amount: num(formData.get("amount")),
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

export async function addScheduledPayments(eventId: string, formData: FormData) {
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

  await supabase.from("scheduled_payments").delete().eq("event_id", eventId);

  const rows = buildScheduleRows({
    total,
    deposit,
    eventDate: eventDate ?? null,
    terms,
    termsDays,
    plan: { kind: "split", count },
    today: new Date().toISOString().slice(0, 10),
  }).map((r) => ({ ...r, event_id: eventId }));

  const { error } = await supabase.from("scheduled_payments").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

/** Office-set billing terms for event types where the office (not the client)
    decides the plan. Read by the public /proposal page when chooser = 'office'. */
export async function updateBillingTerms(eventId: string, formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase.rpc("run_booking_helper", {
    p_helper_id: helperId,
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  // fire this helper's webhook too (so a manual click can test the Zap)
  await fireHelperWebhook(supabase, helperId, eventId);
  // deliver anything the helper queued right away (attachments/sign links
  // are handled at send time) instead of waiting for the 10-minute cron
  await processOutbox();
  await processSmsOutbox();
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

export async function assignStaff(eventId: string, formData: FormData) {
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
  revalidatePath(`/events/${eventId}`);
}

export async function removeStaff(eventId: string, staffId: string) {
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_staff")
    .update({ [field]: new Date().toISOString() })
    .eq("id", staffId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addEventEquipment(eventId: string, formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase.from("event_equipment").delete().eq("id", rowId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function toggleEquipmentPacked(eventId: string, rowId: string, packed: boolean) {
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_equipment")
    .update({ [field]: new Date().toISOString() })
    .eq("id", rowId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function updateEquipmentNotes(eventId: string, rowId: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_equipment")
    .update({ notes: clean(formData.get("notes")) })
    .eq("id", rowId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addLogisticsNote(eventId: string, formData: FormData) {
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

export async function addEventVendor(eventId: string, formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase.from("event_vendors").delete().eq("id", eventVendorId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function updateStaffDetails(eventId: string, staffId: string, formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_staff")
    .update({ portal_visible: visible })
    .eq("id", staffId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function deleteEvent(eventId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("events").delete().eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/events");
  redirect("/events");
}

export async function addEventClient(eventId: string, formData: FormData) {
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
  const supabase = await createClient();
  const firstName = clean(formData.get("first_name"));
  if (!firstName) return;
  const { data: newClient, error: clientError } = await supabase
    .from("clients")
    .insert({
      first_name: firstName,
      last_name: clean(formData.get("last_name")) ?? "",
      cell_phone: clean(formData.get("cell_phone")),
      email: clean(formData.get("email")),
    })
    .select("id")
    .single();
  if (clientError) throw new Error(clientError.message);

  const { count } = await supabase
    .from("event_clients")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  const isFirst = (count ?? 0) === 0;

  const { error } = await supabase.from("event_clients").insert({
    event_id: eventId,
    client_id: newClient.id,
    role: clean(formData.get("role")) ?? "Client",
    is_primary: isFirst,
  });
  if (error) throw new Error(error.message);
  if (isFirst) {
    await supabase.from("events").update({ client_id: newClient.id }).eq("id", eventId);
  }
  await autoNameEvent(supabase, eventId);
  revalidatePath(`/events/${eventId}`);
}

export async function removeEventClient(eventId: string, eventClientId: string) {
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

export async function addClientNote(eventId: string, clientId: string, formData: FormData) {
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
  revalidatePath(`/events/${eventId}`);
}

export async function removeEventAddon(eventId: string, eventAddonId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("event_addons").delete().eq("id", eventAddonId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addExpense(eventId: string, formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addTrip(eventId: string, formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase.from("event_trips").delete().eq("id", tripId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function addEventNote(eventId: string, formData: FormData) {
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

export async function updateEventDetails(eventId: string, formData: FormData) {
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

export async function updateEventFinancials(eventId: string, formData: FormData) {
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
  const supabase = await createClient();
  const { data: before } = await supabase.from("events").select("status_id").eq("id", eventId).maybeSingle();
  const statusId = clean(formData.get("status_id"));
  const { error } = await supabase
    .from("events")
    .update({
      status_id: statusId,
      inquiry_source_id: clean(formData.get("inquiry_source_id")),
      salesperson_id: clean(formData.get("salesperson_id")),
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
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("custom_date_definitions").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}
