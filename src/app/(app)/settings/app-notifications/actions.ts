"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { previewAppNotification, queueAppNotificationTemplate } from "@/lib/appNotifications";
import { APP_NOTIF_TABS } from "@/lib/appNotificationsLogic";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s || null;
}

function bool(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function parseUuidList(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map((v) => v.toString())
    .filter((v) => /^[0-9a-f-]{36}$/i.test(v));
}

export async function createTemplate(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name")) ?? "Untitled notification";
  const { data, error } = await supabase
    .from("app_notification_templates")
    .insert({ name, title: name, is_active: false })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/settings/app-notifications");
  redirect(`/settings/app-notifications/${data.id}`);
}

export async function updateTemplate(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();

  const tapAction = clean(formData.get("tap_action")) ?? "none";
  const tapTab = clean(formData.get("tap_tab"));
  const triggerType = clean(formData.get("trigger_type")) ?? "schedule";

  const { error } = await supabase
    .from("app_notification_templates")
    .update({
      name: clean(formData.get("name")) ?? "Untitled",
      title: clean(formData.get("title")) ?? "",
      body: clean(formData.get("body")) ?? "",
      is_active: bool(formData, "is_active"),
      audience: clean(formData.get("audience")) ?? "hosts",
      trigger_type: triggerType,
      schedule_days: triggerType === "schedule" ? Number(formData.get("schedule_days") || 0) : null,
      schedule_direction: triggerType === "schedule" ? clean(formData.get("schedule_direction")) ?? "before" : null,
      schedule_anchor: clean(formData.get("schedule_anchor")) ?? "event_date",
      schedule_send_time: clean(formData.get("schedule_send_time")) ?? "09:00",
      status_ids: triggerType === "status_change" ? parseUuidList(formData, "status_ids") : [],
      sched_status_ids: parseUuidList(formData, "sched_status_ids"),
      tap_action: tapAction,
      tap_tab: tapAction === "tab" && tapTab && (APP_NOTIF_TABS as readonly string[]).includes(tapTab) ? tapTab : null,
      tap_screen_id: tapAction === "screen" ? clean(formData.get("tap_screen_id")) : null,
      show_as_popup: bool(formData, "show_as_popup"),
      send_push: bool(formData, "send_push"),
      allow_demo_mode: bool(formData, "allow_demo_mode"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/app-notifications");
  revalidatePath(`/settings/app-notifications/${id}`);
}

export async function deleteTemplate(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("app_notification_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/app-notifications");
  redirect("/settings/app-notifications");
}

export async function createScreen(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name")) ?? "Untitled screen";
  const { data, error } = await supabase
    .from("app_notification_screens")
    .insert({ name, heading: name })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/settings/app-notifications");
  redirect(`/settings/app-notifications/screens?edit=${data.id}`);
}

export async function updateScreen(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const buttonsRaw = clean(formData.get("buttons_json")) ?? "[]";
  let buttons: unknown = [];
  try {
    buttons = JSON.parse(buttonsRaw);
  } catch {
    buttons = [];
  }
  const { error } = await supabase
    .from("app_notification_screens")
    .update({
      name: clean(formData.get("name")) ?? "Untitled",
      heading: clean(formData.get("heading")) ?? "",
      body_html: clean(formData.get("body_html")) ?? "",
      buttons,
      embed_source: clean(formData.get("embed_source")) ?? "none",
      custom_embed_html: clean(formData.get("custom_embed_html")),
      is_active: bool(formData, "is_active"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/app-notifications");
  revalidatePath("/settings/app-notifications/screens");
}

export async function deleteScreen(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("app_notification_screens").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/app-notifications");
  revalidatePath("/settings/app-notifications/screens");
}

export async function saveCompanyBookingDefaults(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_settings")
    .update({
      default_booking_url: clean(formData.get("default_booking_url")),
      default_booking_embed_html: clean(formData.get("default_booking_embed_html")),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/app-notifications");
}

/** Preview only — never queues or sends. */
export async function previewTemplateAction(templateId: string, eventId: string) {
  await requireModule("settings", "view", { mode: "throw" });
  const admin = createAdminClient();
  return previewAppNotification(admin, templateId, eventId);
}

/** Staff test queue for one event. Does not call Expo if no tokens; marks through outbox. */
export async function queueTemplateForEvent(templateId: string, eventId: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const admin = createAdminClient();
  const result = await queueAppNotificationTemplate(admin, templateId, eventId, {
    triggerKey: `staff_test:${new Date().toISOString()}`,
    force: true,
  });
  revalidatePath(`/events/${eventId}`);
  return result;
}
