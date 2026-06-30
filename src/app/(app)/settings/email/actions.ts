"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { processOutbox, sendTestEmail } from "@/lib/mailgun";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function createTemplate(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("email_templates").insert({
    group_name: clean(formData.get("group_name")) ?? "GENERAL",
    name: clean(formData.get("name")) ?? "Untitled",
    subject: clean(formData.get("subject")) ?? "",
    body_html: clean(formData.get("body_html")) ?? "",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}

export async function updateTemplate(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("email_templates")
    .update({
      group_name: clean(formData.get("group_name")) ?? "GENERAL",
      name: clean(formData.get("name")) ?? "Untitled",
      subject: clean(formData.get("subject")) ?? "",
      body_html: clean(formData.get("body_html")) ?? "",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}

export async function deleteTemplate(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("email_templates").update({ is_active: false }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}

export async function sendQueuedEmails() {
  await requireModule("settings", "edit", { mode: "throw" });
  await processOutbox();
  revalidatePath("/settings/email");
}

export async function runScheduledNow() {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("run_scheduled_emails");
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}

export async function saveCompanySettings(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_settings")
    .update({
      company_name: clean(formData.get("company_name")) ?? "Xpress Entertainment",
      from_name: clean(formData.get("from_name")) ?? "Xpress Entertainment",
      from_email: clean(formData.get("from_email")) ?? "events@xpressdjs.com",
      reply_to: clean(formData.get("reply_to")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}

export async function sendTest(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const to = clean(formData.get("test_to"));
  if (!to) return;
  await sendTestEmail(to);
  revalidatePath("/settings/email");
}

export async function saveSendingLimits(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_settings")
    .update({
      email_send_window_start: clean(formData.get("email_send_window_start")),
      email_send_window_end: clean(formData.get("email_send_window_end")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}

export async function addBlackoutDate(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const day = clean(formData.get("day"));
  if (!day) return;
  const supabase = await createClient();
  // upsert on the unique day so re-adding the same date just updates the label
  const { error } = await supabase
    .from("email_blackout_dates")
    .upsert({ day, label: clean(formData.get("label")) }, { onConflict: "day" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}

export async function removeBlackoutDate(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("email_blackout_dates").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}
