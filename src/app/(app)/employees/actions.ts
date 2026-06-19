"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { sendAccountInvite, sendPasswordReset } from "@/lib/accounts";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

/** Create/ensure this employee's XOS login and email them a set-password link. */
export async function inviteEmployee(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireModule("employees", "edit", { mode: "throw", supabase });
  const { data: e } = await supabase
    .from("employees")
    .select("email, first_name")
    .eq("id", id)
    .maybeSingle();
  if (!e?.email) return { ok: false, error: "Add an email to this employee first." };
  const res = await sendAccountInvite({
    type: "staff",
    email: e.email,
    name: e.first_name,
    employeeId: id,
  });
  if (res.ok) {
    revalidatePath(`/employees/${id}`);
    revalidatePath("/employees");
  }
  return res;
}

/** Email this employee a password-reset link (login must already exist). */
export async function resetEmployeePassword(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireModule("employees", "edit", { mode: "throw", supabase });
  const { data: e } = await supabase.from("employees").select("email").eq("id", id).maybeSingle();
  if (!e?.email) return { ok: false, error: "No email on file." };
  return await sendPasswordReset(e.email);
}

export async function createEmployee(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("employees").insert({
    first_name: clean(formData.get("first_name")) ?? "",
    last_name: clean(formData.get("last_name")) ?? "",
    email: clean(formData.get("email")),
    phone: clean(formData.get("phone")),
    permission_tier: clean(formData.get("permission_tier")) ?? "employee",
    staff_category: clean(formData.get("staff_category")) ?? "Production",
    hourly_rate: formData.get("hourly_rate")
      ? parseFloat(formData.get("hourly_rate")!.toString())
      : null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}

export async function updateEmployeeGeneral(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .update({
      first_name: clean(formData.get("first_name")) ?? "",
      last_name: clean(formData.get("last_name")) ?? "",
      middle_name: clean(formData.get("middle_name")),
      stage_name: clean(formData.get("stage_name")),
      employment_type: clean(formData.get("employment_type")),
      permission_tier: clean(formData.get("permission_tier")) ?? "employee",
      staff_category: clean(formData.get("staff_category")) ?? "Production",
      hired_date: clean(formData.get("hired_date")),
      profession_since: formData.get("profession_since")
        ? parseInt(formData.get("profession_since")!.toString()) || null
        : null,
      bio: clean(formData.get("bio")),
      notes: clean(formData.get("notes")),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
}

export async function updateEmployeeContact(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .update({
      email: clean(formData.get("email")),
      phone: clean(formData.get("phone")),
      website: clean(formData.get("website")),
      planning_meeting_url: clean(formData.get("planning_meeting_url")),
      address: clean(formData.get("address")),
      emergency_contact: clean(formData.get("emergency_contact")),
      birthday: clean(formData.get("birthday")),
      can_send_as_self: formData.get("can_send_as_self") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/employees/${id}`);
}

export async function updateEmployeeWages(id: string, formData: FormData) {
  const supabase = await createClient();
  const num = (v: FormDataEntryValue | null) => {
    const n = parseFloat((v ?? "0").toString());
    return Number.isFinite(n) ? n : 0;
  };
  const { error } = await supabase
    .from("employees")
    .update({
      hourly_rate: clean(formData.get("hourly_rate")) ? num(formData.get("hourly_rate")) : null,
      addon_commission_pct: num(formData.get("addon_commission_pct")),
      sales_commission_pct: num(formData.get("sales_commission_pct")),
      check_in_required: formData.get("check_in_required") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/employees/${id}`);
}

export async function uploadEmployeePhoto(id: string, formData: FormData) {
  const supabase = await createClient();
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return;
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${id}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("staff")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);
  const { error } = await supabase.from("employees").update({ photo_path: path }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
}

export async function addTimeOff(employeeId: string, formData: FormData) {
  const supabase = await createClient();
  const start = clean(formData.get("start_date"));
  if (!start) return;
  const { error } = await supabase.from("employee_time_off").insert({
    employee_id: employeeId,
    start_date: start,
    end_date: clean(formData.get("end_date")) ?? start,
    status: clean(formData.get("status")) ?? "approved",
    notes: clean(formData.get("notes")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/");
}

export async function setTimeOffStatus(employeeId: string, timeOffId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_time_off")
    .update({ status })
    .eq("id", timeOffId);
  if (error) throw new Error(error.message);
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/");
}

export async function deleteTimeOff(employeeId: string, timeOffId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("employee_time_off").delete().eq("id", timeOffId);
  if (error) throw new Error(error.message);
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/");
}

export async function toggleEmployee(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("employees").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}
