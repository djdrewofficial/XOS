"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe } from "@/lib/auth";

/* Self-service profile edits. Every write is scoped to the CALLER'S OWN employee
   row (resolved from the session, never client-supplied) and limited to a safe
   whitelist — no permission tier, wages, category, active flag, or sending
   identity. Uses the service-role client so it works regardless of the employees
   table's RLS, but only ever touches the caller's own id. */

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

async function myEmployeeId(): Promise<string> {
  const me = await getMe();
  if (!me || me.accountType !== "staff" || !me.employeeId) throw new Error("No staff profile to edit.");
  return me.employeeId;
}

export async function updateMyProfile(formData: FormData) {
  const id = await myEmployeeId();
  const admin = createAdminClient();
  const { error } = await admin
    .from("employees")
    .update({
      first_name: clean(formData.get("first_name")) ?? "",
      last_name: clean(formData.get("last_name")),
      middle_name: clean(formData.get("middle_name")),
      stage_name: clean(formData.get("stage_name")),
      bio: clean(formData.get("bio")),
      phone: clean(formData.get("phone")),
      website: clean(formData.get("website")),
      planning_meeting_url: clean(formData.get("planning_meeting_url")),
      address: clean(formData.get("address")),
      emergency_contact: clean(formData.get("emergency_contact")),
      birthday: clean(formData.get("birthday")),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/account");
}

export async function uploadMyPhoto(formData: FormData) {
  const id = await myEmployeeId();
  const admin = createAdminClient();
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return;
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${id}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await admin.storage
    .from("staff")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);
  const { error } = await admin.from("employees").update({ photo_path: path }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/account");
}
