"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sanitizeKeys } from "@/lib/signingRequirements";
import { NO_EVENT_TYPES } from "@/lib/helperAccess";

export async function saveSigningRequirements(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();

  // global default
  const global = sanitizeKeys(formData.getAll("global_fields").map(String));
  const { error: gErr } = await supabase
    .from("journey_settings")
    .update({ required_signing_fields: global, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (gErr) throw new Error(gErr.message);

  // per-event-type overrides
  const { data: types } = await supabase.from("event_types").select("id").eq("is_active", true);
  for (const t of types ?? []) {
    // required fields: checkbox `type_<id>_override` decides inherit vs explicit
    const override = formData.get(`type_${t.id}_override`) === "on";
    const required = override ? sanitizeKeys(formData.getAll(`type_${t.id}`).map(String)) : null;
    // workflow overrides: blank select value ("") = inherit (null)
    const tpl = (formData.get(`type_${t.id}_template`) ?? "").toString().trim() || null;
    const layout = (formData.get(`type_${t.id}_layout`) ?? "").toString().trim() || null;
    const chooser = (formData.get(`type_${t.id}_chooser`) ?? "").toString().trim() || null;
    const hideFinancials = formData.get(`type_${t.id}_hide_financials`) === "on";
    const { error } = await supabase
      .from("event_types")
      .update({
        required_signing_fields: required,
        proposal_doc_template_id: tpl,
        proposal_layout: layout,
        payment_chooser: chooser,
        hide_financials: hideFinancials,
      })
      .eq("id", t.id);
    if (error) throw new Error(error.message);
  }

  // which booking helpers show on each event type (booking_helpers.visible_event_type_ids)
  if (formData.get("helpers_present") === "1") {
    const activeTypeIds = (types ?? []).map((t) => t.id as string);
    const { data: helpers } = await supabase
      .from("booking_helpers")
      .select("id, visible_event_type_ids")
      .eq("is_active", true);
    for (const h of helpers ?? []) {
      const current = (h.visible_event_type_ids ?? []) as string[];
      const checked = activeTypeIds.filter((tid) => formData.getAll(`type_${tid}_helpers`).map(String).includes(h.id));
      // keep ids of inactive types this page doesn't show
      const hidden = current.filter((tid) => !activeTypeIds.includes(tid) && tid !== NO_EVENT_TYPES);
      let next: string[];
      if (checked.length === activeTypeIds.length && hidden.length === 0) next = []; // every type → unrestricted
      else if (checked.length === 0 && hidden.length === 0) next = [NO_EVENT_TYPES]; // shown on none
      else next = [...checked, ...hidden];
      const same = next.length === current.length && next.every((id) => current.includes(id));
      if (same) continue;
      const { error } = await supabase.from("booking_helpers").update({ visible_event_type_ids: next }).eq("id", h.id);
      if (error) throw new Error(error.message);
    }
    revalidatePath("/settings/helpers");
  }

  revalidatePath("/settings/signing");
  revalidatePath("/events");
}
