"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return (v ?? "").toString().trim();
}

/** Turn the friendly "N days before/after" form into a signed offset_days. */
function offsetDays(fd: FormData): number {
  const when = str(fd.get("offset_when")); // before | on | after
  const mag = Math.abs(parseInt(str(fd.get("offset_magnitude")) || "0", 10)) || 0;
  return when === "before" ? -mag : when === "after" ? mag : 0;
}

function labelFor(offset: number): string {
  if (offset < 0) return `${-offset} day${offset === -1 ? "" : "s"} before due`;
  if (offset > 0) return `${offset} day${offset === 1 ? "" : "s"} past due`;
  return "On the due date";
}

function rulePayload(fd: FormData) {
  const offset_days = offsetDays(fd);
  return {
    offset_days,
    label: labelFor(offset_days),
    send_email: fd.get("send_email") === "on",
    email_template_id: str(fd.get("email_template_id")) || null,
    send_sms: fd.get("send_sms") === "on",
    sms_template_id: str(fd.get("sms_template_id")) || null,
    is_active: fd.get("is_active") === "on",
    updated_at: new Date().toISOString(),
  };
}

export async function createReminderRule(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("payment_reminder_rules").insert(rulePayload(formData));
  if (error) throw new Error(error.message);
  revalidatePath("/settings/payment-reminders");
}

export async function updateReminderRule(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("payment_reminder_rules").update(rulePayload(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/payment-reminders");
}

export async function deleteReminderRule(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("payment_reminder_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/payment-reminders");
}

/** Run the reminder pass now (respects active rules). Queues to the outbox. */
export async function runRemindersNow() {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("run_payment_reminders");
  if (error) throw new Error(error.message);
  revalidatePath("/settings/payment-reminders");
}
