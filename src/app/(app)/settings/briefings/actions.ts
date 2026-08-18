"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModule } from "@/lib/auth";
import { sendStaffBriefings } from "@/lib/staffBriefing";

async function guard() {
  const supabase = await createClient();
  await requireModule("settings", "edit", { mode: "throw", supabase });
  return supabase;
}

/** Per-staff: whether they get the daily briefing and how often. */
export async function setBriefingPref(employeeId: string, patch: { enabled?: boolean; frequency?: string }) {
  const supabase = await guard();
  const row: Record<string, unknown> = { employee_id: employeeId, updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.frequency !== undefined && ["daily", "weekdays", "weekly"].includes(patch.frequency)) row.frequency = patch.frequency;
  await supabase.from("staff_briefing_prefs").upsert(row, { onConflict: "employee_id" });
  revalidatePath("/settings/briefings");
}

/** Whole-feature on/off + the send hour (company timezone). */
export async function setBriefingGlobal(patch: { enabled?: boolean; hour?: number }) {
  const supabase = await guard();
  const { data: cur } = await supabase.from("ai_tasks").select("config").eq("key", "staff_briefings").maybeSingle();
  const config = { ...((cur?.config as Record<string, unknown>) ?? {}) };
  if (patch.hour !== undefined && patch.hour >= 0 && patch.hour <= 23) config.hour = patch.hour;
  const upd: Record<string, unknown> = { config };
  if (patch.enabled !== undefined) upd.enabled = patch.enabled;
  await supabase.from("ai_tasks").update(upd).eq("key", "staff_briefings");
  revalidatePath("/settings/briefings");
}

/** The separate company-wide "Morning Briefing" digest (payments due, unsigned
    agreements, this week's events) → events@xpressdjs.com. */
export async function setCompanySummary(patch: { enabled?: boolean }) {
  const supabase = await guard();
  if (patch.enabled !== undefined) {
    await supabase.from("ai_tasks").update({ enabled: patch.enabled }).eq("key", "morning_briefing");
  }
  revalidatePath("/settings/briefings");
}

/** Send today's briefings right now (for testing). Respects each staffer's enable/cadence. */
export async function sendBriefingsNow(): Promise<{ sent: number }> {
  await guard();
  const admin = createAdminClient();
  const res = await sendStaffBriefings(admin);
  revalidatePath("/settings/briefings");
  return res;
}
