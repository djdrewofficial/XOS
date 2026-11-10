import type { SupabaseClient } from "@supabase/supabase-js";
import { createEventCore, type EventCreateInput } from "@/lib/eventCreate";
import { parseSchedulePlan } from "@/lib/paymentSchedule";

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

const opt = (v: string | null | undefined) => v ?? undefined;

/** The connector's onboarding input in the shape the web form and the mobile endpoint build. */
export function onboardingCreateInput(input: OnboardingInput): EventCreateInput {
  const venue = input.newVenue;
  return {
    clients: (input.clients ?? []).map((c) => ({
      mode: c.mode ?? (c.client_id ? "existing" : "new"),
      client_id: opt(c.client_id),
      first_name: opt(c.first_name),
      last_name: opt(c.last_name),
      email: opt(c.email),
      cell_phone: opt(c.cell_phone),
      role: opt(c.role),
      is_primary: !!c.is_primary,
      is_contract_holder: !!c.is_contract_holder,
    })),
    name: input.name?.trim() || null,
    event_type_id: input.eventTypeId ?? null,
    status_id: input.statusId ?? null,
    event_date: input.eventDate ?? null,
    setup_time: input.setupTime ?? null,
    start_time: input.startTime ?? null,
    end_time: input.endTime ?? null,
    guest_count: input.guestCount ?? null,
    inquiry_source_id: input.inquirySourceId ?? null,
    new_source_name: input.newSourceName ?? null,
    new_source_persist: input.newSourcePersist === true,
    internal_notes: input.internalNotes ?? null,
    contract_notes: input.contractNotes ?? null,
    custom_dates: (input.customDates ?? [])
      .filter((d) => d.definition_id)
      .map((d) => ({ definition_id: d.definition_id!, value: opt(d.value) })),
    package_id: input.packageId ?? null,
    package_price_override: input.packagePriceOverride ?? null,
    deposit_value: input.depositValue ?? null,
    travel_fee: input.travelFee ?? 0,
    discount1_label: null,
    discounts: (input.discounts ?? []).map((d) => ({ label: opt(d.label), amount: d.amount ?? undefined })),
    addons: (input.addons ?? [])
      .filter((a) => a.addon_id)
      .map((a) => ({ addon_id: a.addon_id!, quantity: a.quantity ?? undefined, price_override: a.price_override ?? null })),
    schedule_plan: parseSchedulePlan(input.schedulePlan ?? null),
    use_client_address: input.useClientAddress === true,
    client_address: input.clientAddress ?? null,
    venue_id: input.venueId ?? null,
    venue_room_id: input.venueRoomId ?? null,
    new_venue: venue
      ? {
          name: opt(venue.name),
          address: venue.address ?? null,
          city: venue.city ?? null,
          state: venue.state ?? null,
          zip: venue.zip ?? null,
          lat: venue.lat ?? null,
          lng: venue.lng ?? null,
          place_id: venue.place_id ?? null,
        }
      : null,
    staff: (input.staff ?? [])
      .filter((s) => s.employee_id)
      .map((s) => ({ employee_id: s.employee_id!, role: opt(s.role), flat_wage: s.flat_wage ?? undefined })),
  };
}

/** The new-event wizard for the connector. Same creation path and validation as
    the web form and the mobile endpoint (createEventCore), plus the hold probe,
    drain control, and delete-on-failure cleanup. */
export async function createEventOnboardingRecord(supabase: SupabaseClient, input: OnboardingInput): Promise<{ id: string }> {
  if (input.drain === "hold") {
    const probe = await supabase.rpc("mcp_run_helper_held", {
      p_helper_id: "00000000-0000-4000-8000-000000000000",
      p_event_id: "00000000-0000-4000-8000-000000000000",
    });
    const message = probe.error?.message ?? "";
    if (probe.error && /schema cache|could not find|does not exist/i.test(message)) {
      throw new Error("Holding onboarding mail needs migration 00222. Nothing was created.");
    }
    const effects = await supabase.from("mcp_held_effects").select("id").limit(1);
    if (effects.error && /schema cache|could not find|does not exist|mcp_held_effects/i.test(effects.error.message)) {
      throw new Error("Holding staff notifications and webhooks needs migration 00223. Nothing was created.");
    }
  }
  const id = await createEventCore(supabase, onboardingCreateInput(input), {
    drain: input.drain ?? "all",
    cleanupOnError: true,
  });
  return { id };
}
