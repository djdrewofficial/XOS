"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number {
  const n = parseFloat((v ?? "0").toString());
  return Number.isFinite(n) ? n : 0;
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

export async function createEvent(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .insert(eventPayload(formData))
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/events");
  redirect(`/events/${data.id}`);
}

export async function updateEvent(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("events").update(eventPayload(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${id}`);
  revalidatePath("/events");
  redirect(`/events/${id}`);
}

export async function setEventStatus(id: string, statusId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("events").update({ status_id: statusId }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${id}`);
  revalidatePath("/events");
}

export async function addPayment(eventId: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({
    event_id: eventId,
    amount: num(formData.get("amount")),
    method: clean(formData.get("method")) ?? "other",
    paid_at: clean(formData.get("paid_at")) ?? new Date().toISOString(),
    notes: clean(formData.get("notes")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/payments");
}

export async function addScheduledPayments(eventId: string, formData: FormData) {
  const supabase = await createClient();
  // unlimited scheduled payments with auto-split of the remaining balance
  const count = Math.max(1, Math.round(num(formData.get("count"))));
  const total = num(formData.get("total"));
  const deposit = num(formData.get("deposit"));
  const eventDate = clean(formData.get("event_date"));

  await supabase.from("scheduled_payments").delete().eq("event_id", eventId);

  const rows: {
    event_id: string;
    seq: number;
    amount: number;
    label: string;
    due_date: string | null;
  }[] = [];
  rows.push({
    event_id: eventId,
    seq: 1,
    amount: deposit,
    label: "Deposit",
    due_date: new Date().toISOString().slice(0, 10),
  });

  const remaining = Math.max(0, total - deposit);
  const per = Math.floor((remaining / count) * 100) / 100;
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const amount = isLast ? Math.round((remaining - per * (count - 1)) * 100) / 100 : per;
    let due: string | null = null;
    if (eventDate) {
      // spread evenly: last payment 30 days out, spacing 30 days (DJEP used 60/30)
      const d = new Date(eventDate);
      d.setDate(d.getDate() - 30 * (count - i));
      due = d.toISOString().slice(0, 10);
    }
    rows.push({
      event_id: eventId,
      seq: i + 2,
      amount,
      label: `Payment ${i + 2}`,
      due_date: due,
    });
  }
  const { error } = await supabase.from("scheduled_payments").insert(rows);
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
  const { error } = await supabase.from("client_notes").insert({ client_id: clientId, body });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/clients/${clientId}`);
}

export async function addEventNote(eventId: string, formData: FormData) {
  const supabase = await createClient();
  const body = clean(formData.get("body"));
  if (!body) return;
  const { error } = await supabase.from("event_notes").insert({ event_id: eventId, body });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}
