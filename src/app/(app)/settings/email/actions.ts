"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { processOutbox, sendTestEmail } from "@/lib/mailgun";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function createTemplate(formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase.from("email_templates").update({ is_active: false }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}

export async function sendQueuedEmails() {
  await processOutbox();
  revalidatePath("/settings/email");
}

export async function saveCompanySettings(formData: FormData) {
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
  const to = clean(formData.get("test_to"));
  if (!to) return;
  await sendTestEmail(to);
  revalidatePath("/settings/email");
}
