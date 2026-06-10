"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

type HelperAction = Record<string, string>;

export async function createHelper(formData: FormData) {
  const supabase = await createClient();

  // build the actions array from the structured form
  const actions: HelperAction[] = [];

  const statusId = clean(formData.get("action_status_id"));
  if (statusId) actions.push({ type: "set_status", status_id: statusId });

  for (const field of [
    "initial_contact_date",
    "contract_sent_date",
    "contract_due_date",
    "contract_signed_date",
    "quote_sent_date",
  ]) {
    const value = clean(formData.get(`date_${field}`));
    if (value) actions.push({ type: "set_date", field, value });
  }

  const templateId = clean(formData.get("action_template_id"));
  if (templateId) actions.push({ type: "send_email", template_id: templateId, to: "client" });

  const note = clean(formData.get("action_note"));
  if (note) actions.push({ type: "add_note", body: note });

  const visibleStatuses = formData.getAll("visible_status_ids").map(String).filter(Boolean);

  const { error } = await supabase.from("booking_helpers").insert({
    title: clean(formData.get("title")) ?? "Untitled Helper",
    button_text: clean(formData.get("button_text")) ?? clean(formData.get("title")) ?? "Helper",
    button_bg: clean(formData.get("button_bg")) ?? "#97CC9A",
    button_fg: clean(formData.get("button_fg")) ?? "#000000",
    position: parseInt(clean(formData.get("position")) ?? "0") || 0,
    hide_if_payment_made: formData.get("hide_if_payment_made") === "on",
    hide_if_already_ran: formData.get("hide_if_already_ran") === "on",
    visible_status_ids: visibleStatuses,
    actions,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/helpers");
}

export async function toggleHelper(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("booking_helpers")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/helpers");
}

export async function deleteHelper(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("booking_helpers").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/helpers");
}
