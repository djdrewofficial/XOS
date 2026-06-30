"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sanitizeLayout, type Role } from "@/lib/dashboardWidgets";

export async function saveDashboardLayout(role: Role, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  let parsed: unknown = [];
  try {
    parsed = JSON.parse((formData.get("widgets") ?? "[]").toString());
  } catch {
    parsed = [];
  }
  const widgets = sanitizeLayout(parsed);

  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboard_layouts")
    .upsert({ role, widgets, updated_at: new Date().toISOString() }, { onConflict: "role" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/dashboard");
  revalidatePath("/");
}
