"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { passwordMeetsPolicy } from "@/lib/passwordPolicy";

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

/* Change the signed-in user's own password. The current password is checked
   with a throwaway client so a wrong guess can't replace the session cookie.
   If the project has "Secure password change" on and this session is older
   than a day, we sign in once on the real session (password already verified)
   and retry — that satisfies the reauthentication requirement without a
   dashboard change. */
export async function changeMyPassword(input: {
  current: string;
  next: string;
  confirm: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = input.current ?? "";
  const next = input.next ?? "";
  const confirm = input.confirm ?? "";
  if (!current) return { ok: false, error: "Enter your current password." };
  if (current.length > 256 || next.length > 256) return { ok: false, error: "That password is too long." };
  if (!passwordMeetsPolicy(next)) return { ok: false, error: "Your password doesn't meet all the requirements." };
  if (next !== confirm) return { ok: false, error: "Passwords don't match." };
  if (next === current) return { ok: false, error: "Choose a password that's different from your current one." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email;
  if (!email) return { ok: false, error: "You need to be signed in again." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, error: "Password change is unavailable right now." };

  const verifier = createSupabaseJsClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: pwErr } = await verifier.auth.signInWithPassword({ email, password: current });
  if (pwErr) {
    const code = pwErr.code;
    if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
      return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
    }
    return { ok: false, error: "Current password is incorrect." };
  }

  let { error: updateError } = await supabase.auth.updateUser({ password: next });
  if (updateError && updateError.code === "reauthentication_needed") {
    const { error: refreshErr } = await supabase.auth.signInWithPassword({ email, password: current });
    if (refreshErr) return { ok: false, error: "Current password is incorrect." };
    updateError = (await supabase.auth.updateUser({ password: next })).error;
  }
  if (updateError) {
    if (updateError.code === "same_password") {
      return { ok: false, error: "Choose a password that's different from your current one." };
    }
    if (updateError.code === "weak_password") {
      return { ok: false, error: updateError.message || "That password isn't strong enough." };
    }
    return { ok: false, error: updateError.message };
  }

  await supabase.auth.signOut({ scope: "others" });
  return { ok: true };
}
