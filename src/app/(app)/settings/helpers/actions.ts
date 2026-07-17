"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

type HelperAction = Record<string, string>;

const DATE_FIELDS = [
  "initial_contact_date",
  "contract_sent_date",
  "contract_due_date",
  "contract_signed_date",
  "quote_sent_date",
  "booked_date",
];

function buildHelperPayload(formData: FormData) {
  const actions: HelperAction[] = [];

  const statusId = clean(formData.get("action_status_id"));
  if (statusId) actions.push({ type: "set_status", status_id: statusId });

  const eventTypeId = clean(formData.get("action_event_type_id"));
  if (eventTypeId) actions.push({ type: "set_event_type", event_type_id: eventTypeId });

  const eventName = clean(formData.get("action_event_name"));
  if (eventName) actions.push({ type: "set_event_name", value: eventName });

  const sourceId = clean(formData.get("action_inquiry_source_id"));
  if (sourceId) actions.push({ type: "set_inquiry_source", inquiry_source_id: sourceId });

  const journeyTypeId = clean(formData.get("action_journey_type_id"));
  if (journeyTypeId) actions.push({ type: "start_journey", journey_type_id: journeyTypeId });

  const salespersonId = clean(formData.get("action_salesperson_id"));
  if (salespersonId) actions.push({ type: "set_salesperson", employee_id: salespersonId });

  for (const field of DATE_FIELDS) {
    const value = clean(formData.get(`date_${field}`));
    if (value) actions.push({ type: "set_date", field, value });
  }
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("customdate_")) continue;
    const value = (raw ?? "").toString().trim();
    if (value) actions.push({ type: "set_custom_date", definition_id: key.slice(11), value });
  }

  const assignEmployee = clean(formData.get("action_assign_employee_id"));
  if (assignEmployee) {
    actions.push({
      type: "assign_employee",
      employee_id: assignEmployee,
      role: clean(formData.get("action_assign_role")) ?? "DJ",
    });
  }
  if (formData.get("action_mark_notified") === "on") {
    actions.push({ type: "mark_staff_notified" });
  }

  // times
  const setupBefore = clean(formData.get("setup_before_start_minutes"));
  if (setupBefore) actions.push({ type: "setup_before_start", minutes: setupBefore });
  for (const tf of ["setup_time", "start_time", "end_time"]) {
    const v = clean(formData.get(`time_${tf}`));
    if (v) actions.push({ type: "set_time", field: tf, value: v });
  }

  // emails
  const templateId = clean(formData.get("action_template_id"));
  if (templateId) {
    actions.push({
      type: "send_email",
      template_id: templateId,
      to: "client",
      from: clean(formData.get("action_email_from")) ?? "company",
    });
  }

  const customAddress = clean(formData.get("email_custom_address"));
  const customTemplate = clean(formData.get("email_custom_template_id"));
  if (customAddress && customTemplate) {
    actions.push({ type: "send_email", template_id: customTemplate, to: "custom", address: customAddress });
  }

  const staffTemplate = clean(formData.get("staff_email_template_id"));
  const staffAudience = clean(formData.get("staff_email_audience"));
  if (staffTemplate && staffAudience) {
    actions.push({ type: "send_email_staff", template_id: staffTemplate, audience: staffAudience });
  }

  // texts (HighLevel SMS) — template-based, mirroring the email actions above
  const smsTemplateId = clean(formData.get("action_sms_template_id"));
  if (smsTemplateId) actions.push({ type: "send_sms", to: "client", template_id: smsTemplateId });

  const smsCustomNumber = clean(formData.get("sms_custom_number"));
  const smsCustomTemplate = clean(formData.get("sms_custom_template_id"));
  if (smsCustomNumber && smsCustomTemplate) {
    actions.push({ type: "send_sms", to: "custom", number: smsCustomNumber, template_id: smsCustomTemplate });
  }

  const staffSmsTemplate = clean(formData.get("staff_sms_template_id"));
  const staffSmsAudience = clean(formData.get("staff_sms_audience"));
  if (staffSmsTemplate && staffSmsAudience) {
    actions.push({ type: "send_sms_staff", template_id: staffSmsTemplate, audience: staffSmsAudience });
  }

  const note = clean(formData.get("action_note"));
  if (note) actions.push({ type: "add_note", body: note });

  // secondary helper runs last
  const secondary = clean(formData.get("secondary_helper_id"));
  if (secondary) actions.push({ type: "run_helper", helper_id: secondary });

  const fontSize = parseInt(clean(formData.get("button_font_size")) ?? "", 10);
  const fontWeight = parseInt(clean(formData.get("button_font_weight")) ?? "", 10);

  return {
    title: clean(formData.get("title")) ?? "Untitled Helper",
    description: clean(formData.get("description")),
    button_text: clean(formData.get("button_text")) ?? clean(formData.get("title")) ?? "Helper",
    button_bg: clean(formData.get("button_bg")) ?? "#97CC9A",
    button_fg: clean(formData.get("button_fg")) ?? "#000000",
    button_font_size: Number.isFinite(fontSize) ? fontSize : 16,
    button_font_weight: Number.isFinite(fontWeight) ? fontWeight : 900,
    is_active: formData.get("is_active") === "on",
    hide_if_payment_made: formData.get("hide_if_payment_made") === "on",
    hide_if_already_ran: formData.get("hide_if_already_ran") === "on",
    hide_if_helpers_ran: formData.getAll("hide_if_helpers_ran").map(String).filter(Boolean),
    visible_status_ids: formData.getAll("visible_status_ids").map(String).filter(Boolean),
    required_fields: formData.getAll("required_fields").map(String).filter(Boolean),
    auto_on_create: formData.get("auto_on_create") === "on",
    auto_status_ids: formData.getAll("auto_status_ids").map(String).filter(Boolean),
    auto_on_proposal_confirmed: formData.get("auto_on_proposal_confirmed") === "on",
    auto_on_signed: formData.get("auto_on_signed") === "on",
    auto_on_payment: formData.get("auto_on_payment") === "on",
    event_type_ids: formData.getAll("event_type_ids").map(String).filter(Boolean),
    webhook_url: (formData.get("webhook_url") ?? "").toString().trim() || null,
    planning_template_id: (formData.get("planning_template_id") ?? "").toString().trim() || null,
    actions,
  };
}

export async function createBlankHelper() {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: maxRow } = await supabase
    .from("booking_helpers")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("booking_helpers")
    .insert({
      title: "New Booking Helper",
      button_text: "New Helper",
      is_active: false, // stays off events until configured and activated
      position: (maxRow?.position ?? 0) + 1,
      actions: [],
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/settings/helpers");
  redirect(`/settings/helpers/${data.id}`);
}

export async function createHelper(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: maxRow } = await supabase
    .from("booking_helpers")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("booking_helpers").insert({
    ...buildHelperPayload(formData),
    position: (maxRow?.position ?? 0) + 1,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/helpers");
  redirect("/settings/helpers");
}

export async function updateHelper(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("booking_helpers")
    .update(buildHelperPayload(formData))
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/helpers");
  revalidatePath(`/settings/helpers/${id}`);
  redirect("/settings/helpers");
}

export async function moveHelper(id: string, direction: "up" | "down") {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: helpers } = await supabase
    .from("booking_helpers")
    .select("id, position")
    .order("position")
    .order("created_at");
  if (!helpers) return;
  const idx = helpers.findIndex((h) => h.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= helpers.length) return;
  const a = helpers[idx];
  const b = helpers[swapWith];
  await supabase.from("booking_helpers").update({ position: swapWith }).eq("id", a.id);
  await supabase.from("booking_helpers").update({ position: idx }).eq("id", b.id);
  for (let i = 0; i < helpers.length; i++) {
    if (i !== idx && i !== swapWith && helpers[i].position !== i) {
      await supabase.from("booking_helpers").update({ position: i }).eq("id", helpers[i].id);
    }
  }
  revalidatePath("/settings/helpers");
}

export async function duplicateHelper(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: src } = await supabase.from("booking_helpers").select("*").eq("id", id).single();
  if (!src) return;
  const { data: maxRow } = await supabase
    .from("booking_helpers")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("booking_helpers").insert({
    title: `${src.title} (Copy)`,
    description: src.description,
    button_text: `${src.button_text} (Copy)`,
    button_bg: src.button_bg,
    button_fg: src.button_fg,
    button_font_size: src.button_font_size ?? 16,
    button_font_weight: src.button_font_weight ?? 900,
    position: (maxRow?.position ?? 0) + 1,
    is_active: false, // duplicates start disabled so they don't appear on events until reviewed
    visible_status_ids: src.visible_status_ids,
    hide_if_payment_made: src.hide_if_payment_made,
    hide_if_already_ran: src.hide_if_already_ran,
    hide_if_helpers_ran: src.hide_if_helpers_ran,
    required_fields: src.required_fields ?? [],
    auto_on_create: false, // copies never auto-fire until reviewed
    auto_status_ids: src.auto_status_ids ?? [],
    actions: src.actions,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/helpers");
}

export async function toggleHelper(id: string, isActive: boolean) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("booking_helpers")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/helpers");
}

export async function deleteHelper(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("booking_helpers").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/helpers");
}
