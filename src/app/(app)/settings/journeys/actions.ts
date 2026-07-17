"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return (v ?? "").toString().trim();
}
function bool(fd: FormData, name: string): boolean {
  return fd.get(name) === "on";
}

/** The step toggles + config a journey form submits. */
function journeyPayload(fd: FormData) {
  return {
    name: str(fd.get("name")) || "Untitled Journey",
    description: str(fd.get("description")) || null,
    step_confirm_info: bool(fd, "step_confirm_info"),
    step_sign_agreement: bool(fd, "step_sign_agreement"),
    step_payment: bool(fd, "step_payment"),
    step_app_onboarding: bool(fd, "step_app_onboarding"),
    step_book_meeting: bool(fd, "step_book_meeting"),
    step_planner: bool(fd, "step_planner"),
    agreement_template_id: str(fd.get("agreement_template_id")) || null,
    calendar_embed: str(fd.get("calendar_embed")) || null,
    final_page_heading: str(fd.get("final_page_heading")) || null,
    final_page_body: str(fd.get("final_page_body")) || null,
    is_active: bool(fd, "is_active"),
    updated_at: new Date().toISOString(),
  };
}

export async function createJourneyType(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("journey_types").insert(journeyPayload(formData)).select("id").single();
  if (error) throw new Error(error.message);
  redirect(`/settings/journeys/${data.id}`);
}

export async function updateJourneyType(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("journey_types").update(journeyPayload(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/settings/journeys/${id}`);
  revalidatePath("/settings/journeys");
}

export async function deleteJourneyType(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  // The default journey is the fallback for every un-tagged event — never delete it.
  const { data: jt } = await supabase.from("journey_types").select("is_default").eq("id", id).maybeSingle();
  if (jt?.is_default) throw new Error("The default journey can't be deleted.");
  const { error } = await supabase.from("journey_types").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect("/settings/journeys");
}
