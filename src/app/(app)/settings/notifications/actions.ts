"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PATH = "/settings/notifications";

/** Update one audience row's channels + enabled flag. */
export async function updateSetting(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_settings")
    .update({
      is_enabled: formData.get("is_enabled") === "on",
      in_app: formData.get("in_app") === "on",
      push: formData.get("push") === "on",
      email: formData.get("email") === "on",
      sms: formData.get("sms") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

/** Add a recipient (audience) to a notification type. Push defaults ON. */
export async function addAudience(typeKey: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const audience = (formData.get("audience") ?? "").toString().trim();
  if (!audience) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_settings")
    .insert({ type_key: typeKey, audience, is_enabled: true, in_app: true, push: true, email: false, sms: false })
    .select("id");
  // ignore unique violations (audience already present)
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);
  revalidatePath(PATH);
}

/** Remove a recipient (audience) from a notification type. */
export async function removeAudience(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("notification_settings").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

/** Link (or clear) the email / SMS template used for a client-facing type. */
export async function updateTypeTemplates(typeKey: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_types")
    .update({
      email_template_id: (formData.get("email_template_id") ?? "").toString() || null,
      sms_template_id: (formData.get("sms_template_id") ?? "").toString() || null,
      is_active: formData.get("is_active") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("key", typeKey);
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}
