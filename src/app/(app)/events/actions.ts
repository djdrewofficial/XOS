"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateShortLink } from "@/lib/shortLinks";
import { parseSchedulePlan } from "@/lib/paymentSchedule";
import { loadEventBundle } from "@/lib/documentRender";
import { autoNameEvent } from "@/lib/eventName";
import { createEventOnboardingRecord } from "@/lib/eventOnboarding";
import { runAutomations } from "@/lib/automations";
import { applyPackageSelection, assignAddonEquipment } from "@/lib/packageSelection";
import { executeBookingHelper, previewHelperSms, type HelperSmsOverride, type HelperSmsPrompt } from "@/lib/bookingHelperRun";
import {
  addScheduledPaymentPlan,
  confirmPaymentRecord,
  recordPayment,
  restorePaymentRecord,
  saveRemainingScheduleRows,
  softRemovePayment,
  updatePaymentRecord,
} from "@/lib/paymentOps";
import { archiveEventRecord, assertEventDeletable, unarchiveEventRecord } from "@/lib/eventLifecycle";
import { updateEventFinancialsRecord } from "@/lib/eventFinancials";
import { dispatchNotification } from "@/lib/notify";
import { findOrCreateClient } from "@/lib/clients";
import { reseedEventPlanning, assignAddonSections } from "@/lib/planning";
import { requireModule, getMe } from "@/lib/auth";
import { inviteClientToXos } from "@/lib/accounts";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number {
  const n = parseFloat((v ?? "0").toString());
  return Number.isFinite(n) ? n : 0;
}

/** Money screens besides the event page. revalidatePath("/payments") does not
    cover /payments/scheduled and the other subpages. */
function revalidateMoney(eventId: string) {
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  revalidatePath("/");
  revalidatePath("/payments");
  revalidatePath("/payments/scheduled");
  revalidatePath("/payments/outstanding");
  revalidatePath("/payments/summary");
  revalidatePath("/payments/monthly");
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
  const created = await createEventOnboardingRecord(supabase, {
    clients,
    discounts: parseJson<NewDiscount[]>(formData.get("discounts_json"), []),
    addons: parseJson<NewAddon[]>(formData.get("addons_json"), []),
    staff: parseJson<NewStaff[]>(formData.get("staff_json"), []),
    customDates: parseJson<NewDate[]>(formData.get("custom_dates_json"), []),
    newVenue: parseJson<NewVenue | null>(formData.get("new_venue_json"), null),
    inquirySourceId: clean(formData.get("inquiry_source_id")),
    newSourceName: clean(formData.get("new_source_name")),
    newSourcePersist: formData.get("new_source_persist") === "true" || formData.get("new_source_persist") === "on",
    useClientAddress: formData.get("use_client_address") === "true" || formData.get("use_client_address") === "on",
    clientAddress: clean(formData.get("client_address")),
    venueId: clean(formData.get("venue_id")),
    venueRoomId: clean(formData.get("venue_room_id")),
    eventTypeId: clean(formData.get("event_type_id")),
    name: clean(formData.get("name")),
    statusId: clean(formData.get("status_id")),
    eventDate: clean(formData.get("event_date")),
    setupTime: clean(formData.get("setup_time")),
    startTime: clean(formData.get("start_time")),
    endTime: clean(formData.get("end_time")),
    guestCount: formData.get("guest_count") ? num(formData.get("guest_count")) : null,
    packageId: clean(formData.get("package_id")),
    packagePriceOverride: clean(formData.get("package_price_override")) ? num(formData.get("package_price_override")) : null,
    depositValue: clean(formData.get("deposit_value")) ? num(formData.get("deposit_value")) : 0,
    travelFee: num(formData.get("travel_fee")),
    internalNotes: clean(formData.get("internal_notes")),
    contractNotes: clean(formData.get("contract_notes")),
    schedulePlan: (clean(formData.get("schedule_plan")) ?? (formData.get("schedule_count") ? String(formData.get("schedule_count")) : null)),
    drain: "all",
  });
  revalidatePath("/events");
  redirect(`/events/${created.id}`);
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
  revalidatePath("/");
}

/** Pause/resume automated CLIENT communications (email + SMS) for one event — used
    when the event is being run in parallel with another system (e.g. DJEP). Staff
    notifications are unaffected; the outbox drains enforce this per event. */
export async function setEventCommsPaused(id: string, paused: boolean) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("events").update({ comms_paused: paused }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${id}`);
}

export async function addPayment(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  await recordPayment(supabase, {
    eventId,
    amount: num(formData.get("amount")),
    method: clean(formData.get("method")) ?? "other",
    reason: clean(formData.get("reason")),
    paidAt: clean(formData.get("paid_at")),
    notes: clean(formData.get("notes")),
  });
  revalidateMoney(eventId);
}

/** Fix a recorded payment — wrong amount, date, method, reason or a missing note.
    Card/PayPal amounts are what the processor captured, so those stay fixed. */
export async function updatePayment(paymentId: string, eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const amountRaw = clean(formData.get("amount"));
  await updatePaymentRecord(supabase, {
    paymentId,
    eventId,
    amount: amountRaw == null ? null : num(formData.get("amount")),
    method: clean(formData.get("method")) ?? "other",
    reason: clean(formData.get("reason")),
    paidAt: clean(formData.get("paid_at")),
    notes: clean(formData.get("notes")),
  });
  revalidateMoney(eventId);
}

/** Rewrite the UNPAID part of the payment schedule after the event total changed.
    Paid installments (see scheduleLock) can't be touched; the remaining ones must
    add up to the new total minus what's already paid. */
export async function saveRemainingSchedule(
  eventId: string,
  rows: { id: string | null; amount: number; due_date: string | null }[],
) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  await saveRemainingScheduleRows(supabase, eventId, rows);
  revalidateMoney(eventId);
}

/** "Keep schedule as is" — silence the update-payments prompt until the total changes again. */
export async function acknowledgeScheduleTotal(eventId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const bundle = await loadEventBundle(supabase, eventId);
  if (!bundle) return;
  await supabase.from("events").update({ schedule_ack_total: bundle.total }).eq("id", eventId);
  revalidatePath(`/events/${eventId}`);
}

/* Confirm a pending payment (e.g. a client-reported Zelle claim) once the money
   has actually landed: flip it to approved, link it to the earliest unpaid
   scheduled payment, and fire payment_received automations. */
export async function confirmPayment(paymentId: string, eventId: string, formData?: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  await confirmPaymentRecord(supabase, {
    paymentId,
    eventId,
    note: formData ? clean(formData.get("note")) : null,
  });
  revalidateMoney(eventId);
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
  await softRemovePayment(supabase, { paymentId, eventId, deletedBy: by ?? "staff" });
  revalidateMoney(eventId);
}

/* Restore a soft-deleted payment from the "Recently removed" list. */
export async function restorePayment(paymentId: string, eventId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  await restorePaymentRecord(supabase, { paymentId, eventId });
  revalidateMoney(eventId);
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
  const plan =
    parseSchedulePlan(formData.get("plan")) ??
    parseSchedulePlan(formData.get("count"));
  if (!plan) throw new Error("Pick Full payment due or a deposit + installment split.");
  await addScheduledPaymentPlan(supabase, {
    eventId,
    plan,
    total: num(formData.get("total")),
    deposit: num(formData.get("deposit")),
    eventDate: clean(formData.get("event_date")),
  });
  revalidateMoney(eventId);
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

/** What the prompted texts on this helper would say for this event. */
export async function getHelperSmsPrompts(eventId: string, helperId: string): Promise<HelperSmsPrompt[]> {
  await requireModule("events", "edit", { mode: "throw" });
  return previewHelperSms(createAdminClient(), eventId, helperId);
}

export async function runBookingHelper(
  eventId: string,
  helperId: string,
  // per-action decisions for SMS actions flagged "prompt to send" — skip the text
  // (already texted from a personal phone) or send an edited body
  smsOverrides?: Record<string, HelperSmsOverride>
) {
  await requireModule("events", "edit", { mode: "throw" });
  // Service-role client: run_booking_helper is not executable by a signed-in
  // client (migration 00166). Staff access is gated by requireModule above.
  const me = await getMe();
  await executeBookingHelper(createAdminClient(), {
    eventId,
    helperId,
    smsOverrides,
    actorRole: me?.role ?? null,
    enforceRole: true,
  });
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
  revalidatePath("/");
}

export async function removeStaff(eventId: string, staffId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("event_staff").delete().eq("id", staffId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
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
  const { data: row } = await supabase
    .from("event_staff")
    .select("id, employee_id, event_id")
    .eq("id", eventStaffId)
    .maybeSingle();
  if (!emp || !row || row.employee_id !== emp.id) throw new Error("Not authorized.");
  const { error } = await supabase.from("event_staff").update({ [field]: new Date().toISOString() }).eq("id", eventStaffId);
  if (error) throw new Error(error.message);
  revalidatePath("/");
  if (row.event_id) revalidatePath(`/events/${row.event_id}`);
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
  revalidatePath("/payroll");
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

/** Plain-form wrapper around uploadEventFile (returns void so it can be a `<form action>`
    directly — used by the Planning/Notes hub's Vibo/timeline PDF upload). */
export async function uploadEventFileForm(eventId: string, formData: FormData) {
  await uploadEventFile(eventId, null, formData);
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
  await assertEventDeletable(createAdminClient(), eventId);

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
  await archiveEventRecord(supabase, eventId, await actorName(supabase));

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  redirect("/events");
}

export async function unarchiveEvent(eventId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  await requireTier(supabase, ["master_admin", "admin", "salesperson"]);
  await unarchiveEventRecord(supabase, eventId, await actorName(supabase));

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

export async function addEventClient(eventId: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const clientId = clean(formData.get("client_id"));
  if (!clientId) return;
  const { error } = await createAdminClient().rpc("mcp_add_event_client", {
    p_event_id: eventId,
    p_client_id: clientId,
    p_role: clean(formData.get("role")) ?? "Client",
  });
  if (error) {
    if (/mcp_add_event_client|schema cache|could not find/i.test(error.message)) {
      throw new Error("Adding a client needs migration 00219. Nothing was added.");
    }
    throw new Error(error.message);
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

  const { error } = await createAdminClient().rpc("mcp_add_event_client", {
    p_event_id: eventId,
    p_client_id: found.id,
    p_role: clean(formData.get("role")) ?? "Client",
  });
  if (error) {
    if (/mcp_add_event_client|schema cache|could not find/i.test(error.message)) {
      throw new Error("Adding a client needs migration 00219. Nothing was added.");
    }
    throw new Error(error.message);
  }
  await autoNameEvent(supabase, eventId);
  revalidatePath(`/events/${eventId}`);
}

export async function removeEventClient(eventId: string, eventClientId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const admin = createAdminClient();
  const { error } = await admin.rpc("mcp_remove_event_client", {
    p_event_id: eventId,
    p_event_client_id: eventClientId,
  });
  if (error) {
    if (/mcp_remove_event_client|schema cache|could not find/i.test(error.message)) {
      throw new Error("Removing a client needs migration 00218. Nothing was deleted.");
    }
    throw new Error(error.message);
  }
  revalidatePath(`/events/${eventId}`);
}

export async function setPrimaryEventClient(eventId: string, eventClientId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const { error } = await createAdminClient().rpc("mcp_set_primary_client", {
    p_event_id: eventId,
    p_event_client_id: eventClientId,
  });
  if (error) {
    if (/mcp_set_primary_client|schema cache|could not find/i.test(error.message)) {
      throw new Error("Choosing the primary client needs migration 00219. Nothing was changed.");
    }
    throw new Error(error.message);
  }
  revalidatePath(`/events/${eventId}`);
}

export async function toggleContractHolder(eventId: string, eventClientId: string, value: boolean) {
  await requireModule("events", "edit", { mode: "throw" });
  const { error } = await createAdminClient().rpc("mcp_toggle_contract_holder", {
    p_event_id: eventId,
    p_event_client_id: eventClientId,
    p_value: value,
  });
  if (error) {
    if (/mcp_toggle_contract_holder|schema cache|could not find/i.test(error.message)) {
      throw new Error("Updating the contract holder needs migration 00219. Nothing was changed.");
    }
    throw new Error(error.message);
  }
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

/** This event's wording for its package (blank / unchanged = the catalog description). */
export async function updateEventPackageDescription(eventId: string, baseDescription: string, formData: FormData) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const text = (formData.get("description") ?? "").toString().replace(/\r\n/g, "\n").trim();
  const override = text && text !== baseDescription.replace(/\r\n/g, "\n").trim() ? text : null;
  const { error } = await supabase.from("events").update({ package_description_override: override }).eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

/** Edit an add-on already on the event: quantity, this event's price, and its wording. */
export async function updateEventAddon(
  eventId: string,
  eventAddonId: string,
  base: { price: number; description: string },
  formData: FormData
) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const update: Record<string, unknown> = {
    quantity: Math.max(1, Math.round(num(formData.get("quantity")) || 1)),
  };
  // price: blank or the locked/catalog price → no override
  const priceRaw = clean(formData.get("price"));
  const price = priceRaw != null ? num(formData.get("price")) : null;
  update.price_override = price != null && price !== base.price ? price : null;
  // wording: blank or unchanged → back to the catalog description
  const text = (formData.get("description") ?? "").toString().replace(/\r\n/g, "\n").trim();
  update.description_override = text && text !== base.description.replace(/\r\n/g, "\n").trim() ? text : null;
  const { error } = await supabase.from("event_addons").update(update).eq("id", eventAddonId).eq("event_id", eventId);
  if (error) throw new Error(error.message);
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
  revalidatePath("/");
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
  const overrideSubmitted = clean(formData.get("package_price_override")) != null;
  const nn = (name: string) => Math.max(0, num(formData.get(name)));
  await updateEventFinancialsRecord(supabase, eventId, {
    packageId: clean(formData.get("package_id")),
    packagePriceOverride: overrideSubmitted ? nn("package_price_override") : null,
    overrideSubmitted,
    deposit: nn("deposit_value"),
    overtime: nn("overtime_fee"),
    travel: nn("travel_fee"),
    discount1: nn("discount1_amount"),
    discount2: nn("discount2_amount"),
  });
  revalidateMoney(eventId);
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
  revalidatePath("/");
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

  // custom date fields arrive as custom_<definitionId>. One delete and one
  // upsert, not a round trip per field.
  const clearIds: string[] = [];
  const upserts: { event_id: string; definition_id: string; value: string }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("custom_")) continue;
    const definitionId = key.slice(7);
    if (!definitionId) continue;
    const value = (raw ?? "").toString().trim();
    if (value === "") clearIds.push(definitionId);
    else upserts.push({ event_id: eventId, definition_id: definitionId, value });
  }
  if (clearIds.length) {
    const { error: delErr } = await supabase
      .from("event_custom_dates")
      .delete()
      .eq("event_id", eventId)
      .in("definition_id", clearIds);
    if (delErr) throw new Error(delErr.message);
  }
  if (upserts.length) {
    const { error: upErr } = await supabase
      .from("event_custom_dates")
      .upsert(upserts, { onConflict: "event_id,definition_id" });
    if (upErr) throw new Error(upErr.message);
  }
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  revalidatePath("/");
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
