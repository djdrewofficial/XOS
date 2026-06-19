"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function saveGeneralSettings(formData: FormData) {
  const supabase = await createClient();
  const notifTypes = formData.getAll("notif_types").map(String).filter(Boolean);
  const { error } = await supabase
    .from("company_settings")
    .update({
      timezone: clean(formData.get("timezone")) ?? "America/New_York",
      phone_format_enabled: formData.get("phone_format_enabled") === "on",
      browser_autocomplete: formData.get("browser_autocomplete") === "on",
      notif_sound: formData.get("notif_sound") === "on",
      notif_types: notifTypes,
      inbox_show_counter: formData.get("inbox_show_counter") === "on",
      default_template_event_id: clean(formData.get("default_template_event_id")),
      landing_page: clean(formData.get("landing_page")) ?? "/",
      legal_venue: clean(formData.get("legal_venue")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/general");
  revalidatePath("/", "layout");
}
