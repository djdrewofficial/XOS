"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveJourneySettings(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("journey_settings")
    .update({
      welcome_heading: (formData.get("welcome_heading") ?? "").toString().trim() || "Welcome to the family! 🎉",
      welcome_body: (formData.get("welcome_body") ?? "").toString(),
      confetti: formData.get("confetti") === "on",
      proposal_flow_enabled: formData.get("proposal_flow_enabled") === "on",
      proposal_doc_template_id: (formData.get("proposal_doc_template_id") ?? "").toString().trim() || null,
      proposal_layout: (formData.get("proposal_layout") ?? "couple").toString().trim() || "couple",
      payment_chooser: (formData.get("payment_chooser") ?? "client").toString().trim() || "client",
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/journey");
}
