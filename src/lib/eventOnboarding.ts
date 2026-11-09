import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrCreateClient } from "@/lib/clients";
import { loadEventBundle } from "@/lib/documentRender";
import { buildEventName, type NamingClient } from "@/lib/eventName";
import { applyPackageSelection } from "@/lib/packageSelection";
import { buildScheduleRows, parseSchedulePlan } from "@/lib/paymentSchedule";
import { runAutomations } from "@/lib/automations";

export type OnboardingClient = {
  mode?: "existing" | "new";
  client_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  cell_phone?: string | null;
  role?: string | null;
  is_primary?: boolean;
  is_contract_holder?: boolean;
};

export type OnboardingInput = {
  clients: OnboardingClient[];
  discounts?: { label?: string | null; amount?: number | null }[];
  addons?: { addon_id?: string | null; quantity?: number | null; price_override?: number | null }[];
  staff?: { employee_id?: string | null; role?: string | null; flat_wage?: number | null }[];
  customDates?: { definition_id?: string | null; value?: string | null }[];
  newVenue?: { name?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; lat?: number | null; lng?: number | null; place_id?: string | null } | null;
  inquirySourceId?: string | null;
  newSourceName?: string | null;
  newSourcePersist?: boolean;
  useClientAddress?: boolean;
  clientAddress?: string | null;
  venueId?: string | null;
  venueRoomId?: string | null;
  eventTypeId?: string | null;
  name?: string | null;
  statusId?: string | null;
  eventDate?: string | null;
  setupTime?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  guestCount?: number | null;
  packageId?: string | null;
  packagePriceOverride?: number | null;
  depositValue?: number | null;
  travelFee?: number | null;
  internalNotes?: string | null;
  contractNotes?: string | null;
  schedulePlan?: string | null;
  /** Staff clicks keep the existing global drain. Agent calls pass "hold" so mail is born held. */
  drain?: "all" | "event" | "hold";
};

/** The new-event wizard, without the form or the redirect. */
export async function createEventOnboardingRecord(supabase: SupabaseClient, input: OnboardingInput): Promise<{ id: string }> {
  if (input.drain === "hold") {
    const probe = await supabase.rpc("mcp_run_helper_held", {
      p_helper_id: "00000000-0000-4000-8000-000000000000",
      p_event_id: "00000000-0000-4000-8000-000000000000",
    });
    const message = probe.error?.message ?? "";
    if (probe.error && /schema cache|could not find|does not exist/i.test(message)) {
      throw new Error("Holding onboarding mail needs migration 00220. Nothing was created.");
    }
  }
  const clients = input.clients ?? [];
  const primaryIn = clients.find((c) => c.is_primary) ?? clients[0];
  if (!primaryIn) throw new Error("Add a primary client before creating the event.");
  let pf = primaryIn.first_name, pl = primaryIn.last_name, pe = primaryIn.email, pc = primaryIn.cell_phone;
  if (primaryIn.mode === "existing" && primaryIn.client_id) {
    const { data: pc0 } = await supabase.from("clients").select("first_name, last_name, email, cell_phone").eq("id", primaryIn.client_id).maybeSingle();
    pf = pc0?.first_name ?? pf; pl = pc0?.last_name ?? pl; pe = pc0?.email ?? pe; pc = pc0?.cell_phone ?? pc;
  }
  const missingPrimary = [!pf?.trim() && "first name", !pl?.trim() && "last name", !pe?.trim() && "email", !pc?.trim() && "cell phone"].filter(Boolean);
  if (missingPrimary.length) throw new Error(`Primary client is missing: ${missingPrimary.join(", ")}.`);

  const resolved: { client_id: string; role: string | null; is_primary: boolean; is_contract_holder: boolean; naming: NamingClient }[] = [];
  for (const c of clients) {
    let id = c.client_id ?? null;
    let first = c.first_name ?? "";
    let last = c.last_name ?? "";
    if (c.mode === "new" || !id) {
      if (!first && !c.email && !c.cell_phone) continue;
      const found = await findOrCreateClient(supabase, { first_name: first, last_name: last, email: c.email, cell_phone: c.cell_phone });
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

  let inquirySourceId = input.inquirySourceId ?? null;
  if (!inquirySourceId && input.newSourceName) {
    const { data: src } = await supabase.from("inquiry_sources").insert({ name: input.newSourceName, is_active: input.newSourcePersist === true }).select("id").single();
    inquirySourceId = src?.id ?? null;
  }

  let venueId = input.useClientAddress ? null : (input.venueId ?? null);
  if (input.useClientAddress) {
    if (input.clientAddress && primary) await supabase.from("clients").update({ mailing_address: input.clientAddress }).eq("id", primary.client_id);
  } else if (!venueId && input.newVenue?.name) {
    const venue = input.newVenue;
    const { data: v } = await supabase.from("venues").insert({
      name: venue.name,
      address: venue.address ?? null,
      city: venue.city ?? null,
      state: venue.state ?? null,
      zip: venue.zip ?? null,
      lat: venue.lat ?? null,
      lng: venue.lng ?? null,
      google_place_id: venue.place_id ?? null,
    }).select("id").single();
    venueId = v?.id ?? null;
  }

  let typeName: string | null = null;
  if (input.eventTypeId) {
    const { data: t } = await supabase.from("event_types").select("name").eq("id", input.eventTypeId).maybeSingle();
    typeName = t?.name ?? null;
  }
  const name = input.name?.trim() || buildEventName(resolved.map((r) => r.naming), typeName) || "New Event";
  const discounts = input.discounts ?? [];
  const { data: event, error: evErr } = await supabase.from("events").insert({
    name,
    event_type_id: input.eventTypeId ?? null,
    status_id: input.statusId ?? null,
    inquiry_source_id: inquirySourceId,
    client_id: primary?.client_id ?? null,
    event_date: input.eventDate ?? null,
    setup_time: input.setupTime ?? null,
    start_time: input.startTime ?? null,
    end_time: input.endTime ?? null,
    guest_count: input.guestCount ?? null,
    venue_id: venueId,
    venue_room_id: input.venueRoomId ?? null,
    use_client_address: input.useClientAddress === true,
    package_id: input.packageId ?? null,
    package_price_override: input.packagePriceOverride ?? null,
    deposit_value: input.depositValue ?? 0,
    travel_fee: input.travelFee ?? 0,
    discount1_label: discounts[0]?.label ?? null,
    discount1_amount: discounts[0]?.amount ?? 0,
    discount2_label: discounts[1]?.label ?? null,
    discount2_amount: discounts[1]?.amount ?? 0,
    internal_notes: input.internalNotes ?? null,
  }).select("id").single();
  if (evErr) throw new Error(evErr.message);
  const eventId = event.id as string;

  if (resolved.length) {
    await supabase.from("event_clients").insert(resolved.map((r) => ({
      event_id: eventId, client_id: r.client_id, role: r.role ?? "Client", is_primary: r.is_primary, is_contract_holder: r.is_contract_holder,
    })));
  }
  if (input.packageId) await applyPackageSelection(supabase, eventId, input.packageId, input.eventDate ?? null, input.packagePriceOverride != null);
  const addonRows = (input.addons ?? []).filter((a) => a.addon_id).map((a) => ({
    event_id: eventId, addon_id: a.addon_id, quantity: a.quantity && a.quantity > 0 ? a.quantity : 1, price_override: a.price_override ?? null,
  }));
  if (addonRows.length) await supabase.from("event_addons").insert(addonRows);
  if (input.contractNotes) await supabase.from("event_notes").insert({ event_id: eventId, body: input.contractNotes, kind: "contract" });
  const dateRows = (input.customDates ?? []).filter((d) => d.definition_id && d.value).map((d) => ({ event_id: eventId, definition_id: d.definition_id, value: d.value }));
  if (dateRows.length) await supabase.from("event_custom_dates").upsert(dateRows, { onConflict: "event_id,definition_id" });

  const schedulePlan = parseSchedulePlan(input.schedulePlan ?? null);
  if (schedulePlan) {
    const bundle = await loadEventBundle(supabase, eventId);
    const { data: evDep } = await supabase.from("events").select("deposit_value, event_date").eq("id", eventId).single();
    let terms: "days_before" | "net_days_after" = "days_before";
    let termsDays = 30;
    if (input.packageId) {
      const { data: pkg } = await supabase.from("packages").select("payment_terms, payment_terms_days").eq("id", input.packageId).maybeSingle();
      if (pkg) {
        terms = (pkg.payment_terms as typeof terms) ?? "days_before";
        termsDays = pkg.payment_terms_days ?? 30;
      }
    }
    const rows = buildScheduleRows({
      total: bundle?.total ?? 0,
      deposit: Number(evDep?.deposit_value ?? 0),
      eventDate: evDep?.event_date ?? null,
      terms,
      termsDays,
      plan: schedulePlan,
      today: new Date().toISOString().slice(0, 10),
    }).map((r) => ({ ...r, event_id: eventId }));
    await supabase.from("scheduled_payments").insert(rows);
  }

  const staffRows = (input.staff ?? []).filter((s) => s.employee_id).map((s) => ({
    event_id: eventId, employee_id: s.employee_id, role: s.role || "DJ", flat_wage: s.flat_wage ?? 0,
  }));
  if (staffRows.length) await supabase.from("event_staff").insert(staffRows);
  await runAutomations(supabase, eventId, "event_created", { drain: input.drain ?? "all" });
  return { id: eventId };
}
