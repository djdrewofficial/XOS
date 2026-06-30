"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { staffHours, staffCost } from "@/lib/payroll";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number {
  const n = parseFloat((v ?? "0").toString());
  return Number.isFinite(n) ? n : 0;
}

/** Payroll writes require Edit access to the Payroll screen (Settings → Permissions). */
async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authorized.");
  await requireModule("payroll", "edit", { mode: "throw", supabase });
  return user.id;
}

export async function savePayrollSettings(formData: FormData) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  await requireAdmin(supabase);
  await supabase
    .from("payroll_settings")
    .update({ frequency: clean(formData.get("frequency")) ?? "biweekly", anchor_payday: clean(formData.get("anchor_payday")) })
    .eq("id", true);
  revalidatePath("/payroll");
}

/* Materialize auto payables (one per staffer per event) for a pay period, owed =
   computed staff cost. Idempotent: updates existing auto rows, inserts new ones;
   never deletes (would orphan logged payments). */
export async function generatePayables(payday: string, periodStart: string, periodEnd: string) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, setup_time, start_time, end_time, status:event_statuses(counts_payroll), venue:venues(travel_minutes), event_staff(id, employee_id, role, pay_type, flat_wage, start_time, end_time, checked_in_at, checked_out_at, employee:employees(hourly_rate))"
    )
    .is("archived_at", null)
    .gte("event_date", periodStart)
    .lte("event_date", periodEnd);

  const { data: existing } = await supabase
    .from("payroll_payables")
    .select("id, employee_id, event_id")
    .eq("pay_period", payday)
    .eq("source", "auto");
  const existingByKey = new Map((existing ?? []).map((r) => [`${r.employee_id}|${r.event_id}`, r.id as string]));

  const toInsert: Record<string, unknown>[] = [];
  for (const ev of events ?? []) {
    if (!(ev.status as unknown as { counts_payroll?: boolean } | null)?.counts_payroll) continue;
    const travel = (ev.venue as unknown as { travel_minutes?: number | null } | null)?.travel_minutes ?? 0;
    for (const es of (ev.event_staff ?? []) as Array<{
      id: string;
      employee_id: string | null;
      role: string | null;
      pay_type: string | null;
      flat_wage: number | null;
      start_time: string | null;
      end_time: string | null;
      checked_in_at: string | null;
      checked_out_at: string | null;
      employee: { hourly_rate?: number | null } | null;
    }>) {
      if (!es.employee_id) continue;
      const hours = staffHours(es, ev, travel, { actual: !!(es.checked_in_at && es.checked_out_at) });
      const cost = staffCost(es, es.employee, hours);
      const key = `${es.employee_id}|${ev.id}`;
      const existingId = existingByKey.get(key);
      if (existingId) {
        await supabase.from("payroll_payables").update({ amount_owed: cost, description: es.role }).eq("id", existingId);
      } else {
        toInsert.push({
          pay_period: payday,
          payee_kind: "employee",
          employee_id: es.employee_id,
          event_id: ev.id,
          description: es.role,
          amount_owed: cost,
          source: "auto",
        });
      }
    }
  }
  if (toInsert.length) await supabase.from("payroll_payables").insert(toInsert);
  revalidatePath("/payroll");
}

export async function logPayment(payableId: string, formData: FormData) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  await requireAdmin(supabase);
  const amount = num(formData.get("amount"));
  if (amount <= 0) return;
  const { error } = await supabase.from("payroll_payments").insert({
    payable_id: payableId,
    amount,
    method: clean(formData.get("method")),
    notes: clean(formData.get("notes")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/payroll");
}

export async function addManualPayable(payday: string, formData: FormData) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  await requireAdmin(supabase);
  const payee_kind = (clean(formData.get("payee_kind")) ?? "vendor") as "employee" | "vendor" | "contractor";
  const { error } = await supabase.from("payroll_payables").insert({
    pay_period: payday,
    payee_kind,
    vendor_id: payee_kind === "vendor" ? clean(formData.get("vendor_id")) : null,
    employee_id: payee_kind === "employee" ? clean(formData.get("employee_id")) : null,
    payee_name: clean(formData.get("payee_name")),
    description: clean(formData.get("description")),
    amount_owed: num(formData.get("amount_owed")),
    source: "manual",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/payroll");
}

export async function removePayable(payableId: string) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  await requireAdmin(supabase);
  await supabase.from("payroll_payables").delete().eq("id", payableId);
  revalidatePath("/payroll");
}

export async function approveTimesheetChange(id: string) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  const reviewer = await requireAdmin(supabase);
  const { data: req } = await supabase.from("timesheet_change_requests").select("*").eq("id", id).maybeSingle();
  if (!req) return;
  const patch: Record<string, string> = {};
  if (req.requested_check_in) patch.checked_in_at = req.requested_check_in;
  if (req.requested_check_out) patch.checked_out_at = req.requested_check_out;
  if (Object.keys(patch).length) await supabase.from("event_staff").update(patch).eq("id", req.event_staff_id);
  await supabase
    .from("timesheet_change_requests")
    .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: reviewer })
    .eq("id", id);
  revalidatePath("/payroll");
}

export async function denyTimesheetChange(id: string) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  const reviewer = await requireAdmin(supabase);
  await supabase
    .from("timesheet_change_requests")
    .update({ status: "denied", reviewed_at: new Date().toISOString(), reviewed_by: reviewer })
    .eq("id", id);
  revalidatePath("/payroll");
}
