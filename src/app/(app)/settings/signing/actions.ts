"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sanitizeKeys } from "@/lib/signingRequirements";

export async function saveSigningRequirements(formData: FormData) {
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
    const { error } = await supabase
      .from("event_types")
      .update({
        required_signing_fields: required,
        proposal_doc_template_id: tpl,
        proposal_layout: layout,
        payment_chooser: chooser,
      })
      .eq("id", t.id);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/settings/signing");
  revalidatePath("/events");
}
