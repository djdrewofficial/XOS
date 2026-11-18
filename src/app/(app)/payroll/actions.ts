"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { staffCost, staffCostForPayroll, staffHours } from "@/lib/payroll";
import type { TimeClockSettingsLite } from "@/lib/timeClock";

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

/* Materialize auto payables for a pay period.
   Hourly: only approved/locked timesheets (uses locked amount).
   Flat: always included from flat_wage. */
export async function generatePayables(payday: string, periodStart: string, periodEnd: string) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data: clockSettings } = await supabase.from("time_clock_settings").select("*").eq("id", true).maybeSingle();
  const settings = clockSettings as TimeClockSettingsLite | null;
  const requireApproval = settings?.require_approval_before_payroll !== false;

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, setup_time, start_time, end_time, status:event_statuses(counts_payroll), venue:venues(travel_minutes), event_staff(id, employee_id, role, pay_type, flat_wage, hourly_rate_override, timesheet_status, timesheet_hours, timesheet_amount, timesheet_rate, start_time, end_time, checked_in_at, checked_out_at, employee:employees!event_staff_employee_id_fkey(hourly_rate))"
    )
    .is("archived_at", null)
    .gte("event_date", periodStart)
    .lte("event_date", periodEnd);

  const staffIds = (events ?? []).flatMap((ev) =>
    ((ev.event_staff ?? []) as { id: string }[]).map((es) => es.id)
  );
  const punchesByStaff: Record<string, { punch_type: string; punched_at: string; deleted_at: string | null }[]> = {};
  if (staffIds.length) {
    const { data: punches } = await supabase
      .from("time_punches")
      .select("event_staff_id, punch_type, punched_at, deleted_at")
      .in("event_staff_id", staffIds)
      .is("deleted_at", null);
    for (const p of punches ?? []) {
      const sid = p.event_staff_id as string;
      if (!punchesByStaff[sid]) punchesByStaff[sid] = [];
      punchesByStaff[sid].push({
        punch_type: p.punch_type as string,
        punched_at: p.punched_at as string,
        deleted_at: null,
      });
    }
  }

  const { data: existing } = await supabase
    .from("payroll_payables")
    .select("id, employee_id, event_id")
    .eq("pay_period", payday)
    .eq("source", "auto");
  const existingByKey = new Map((existing ?? []).map((r) => [`${r.employee_id}|${r.event_id}`, r.id as string]));

  const toInsert: Record<string, unknown>[] = [];
  const linkUpdates: { eventStaffId: string; payableId: string }[] = [];

  for (const ev of events ?? []) {
    if (!(ev.status as unknown as { counts_payroll?: boolean } | null)?.counts_payroll) continue;
    const travel = (ev.venue as unknown as { travel_minutes?: number | null } | null)?.travel_minutes ?? 0;
    for (const es of (ev.event_staff ?? []) as Array<{
      id: string;
      employee_id: string | null;
      role: string | null;
      pay_type: string | null;
      flat_wage: number | null;
      hourly_rate_override: number | null;
      timesheet_status: string | null;
      timesheet_hours: number | null;
      timesheet_amount: number | null;
      timesheet_rate: number | null;
      start_time: string | null;
      end_time: string | null;
      checked_in_at: string | null;
      checked_out_at: string | null;
      employee: { hourly_rate?: number | null } | null;
    }>) {
      if (!es.employee_id) continue;
      const payType = es.pay_type ?? "flat";
      const punches = punchesByStaff[es.id] ?? [];
      const hours = staffHours(es, ev, travel, {
        actual: !!(es.checked_in_at && es.checked_out_at) || punches.length > 0,
        punches,
        settings,
        punchedHourly: payType === "hourly" && punches.length > 0,
      });

      let cost: number | null;
      if (payType === "hourly" && requireApproval) {
        cost = staffCostForPayroll(es, es.employee, hours);
        if (cost == null) continue; // skip unapproved hourly
      } else {
        cost = staffCost(es, es.employee, hours);
      }

      const key = `${es.employee_id}|${ev.id}`;
      const existingId = existingByKey.get(key);
      if (existingId) {
        await supabase.from("payroll_payables").update({ amount_owed: cost, description: es.role }).eq("id", existingId);
        linkUpdates.push({ eventStaffId: es.id, payableId: existingId });
      } else {
        toInsert.push({
          pay_period: payday,
          payee_kind: "employee",
          employee_id: es.employee_id,
          event_id: ev.id,
          description: es.role,
          amount_owed: cost,
          source: "auto",
          _event_staff_id: es.id,
        });
      }
    }
  }

  if (toInsert.length) {
    const pendingLinks = toInsert.map((r) => ({
      eventStaffId: r._event_staff_id as string,
      employee_id: r.employee_id as string,
      event_id: r.event_id as string,
    }));
    const rows = toInsert.map(({ _event_staff_id: _, ...rest }) => rest);
    const { data: inserted, error } = await supabase.from("payroll_payables").insert(rows).select("id, employee_id, event_id");
    if (error) throw new Error(error.message);
    for (const row of inserted ?? []) {
      const match = pendingLinks.find((p) => p.employee_id === row.employee_id && p.event_id === row.event_id);
      if (match) linkUpdates.push({ eventStaffId: match.eventStaffId, payableId: row.id as string });
    }
  }

  for (const link of linkUpdates) {
    await supabase
      .from("event_staff")
      .update({ timesheet_payable_id: link.payableId, timesheet_status: "locked" })
      .eq("id", link.eventStaffId)
      .in("timesheet_status", ["approved", "locked"]);
  }

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
  // Mark linked timesheets paid when fully covered
  const { data: payable } = await supabase
    .from("payroll_payables")
    .select("id, amount_owed, payments:payroll_payments(amount)")
    .eq("id", payableId)
    .maybeSingle();
  if (payable) {
    const paid = ((payable.payments as { amount: number }[] | null) ?? []).reduce((s, x) => s + Number(x.amount), 0);
    if (paid + 0.001 >= Number(payable.amount_owed)) {
      await supabase.from("event_staff").update({ timesheet_status: "paid", paid_at: new Date().toISOString() }).eq("timesheet_payable_id", payableId);
    }
  }
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
  await supabase.from("event_staff").update({ timesheet_payable_id: null }).eq("timesheet_payable_id", payableId);
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
