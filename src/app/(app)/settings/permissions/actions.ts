"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { MODULE_KEYS, isModuleKey, ROLES, type Access, type Role } from "@/lib/permissions";

const ACCESS_VALUES: Access[] = ["none", "view", "edit"];
const ROLE_KEYS = ROLES.map(([r]) => r) as Role[];

function asAccess(v: FormDataEntryValue | null): Access | null {
  const s = (v ?? "").toString();
  return (ACCESS_VALUES as string[]).includes(s) ? (s as Access) : null;
}
function asLanding(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

/** Save one role's per-module access grid + its default landing page. */
export async function saveRolePermissions(role: Role, formData: FormData) {
  if (!ROLE_KEYS.includes(role) || role === "master_admin") {
    throw new Error("That role can't be edited.");
  }
  const supabase = await createClient();
  await requireModule("settings", "edit", { mode: "throw", supabase });

  const now = new Date().toISOString();
  const rows = MODULE_KEYS.map((module) => ({
    role,
    module,
    access: asAccess(formData.get(`perm_${module}`)) ?? "none",
    updated_at: now,
  }));

  const { error } = await supabase
    .from("role_permissions")
    .upsert(rows, { onConflict: "role,module" });
  if (error) throw new Error(error.message);

  const { error: lErr } = await supabase
    .from("role_settings")
    .upsert(
      { role, landing_page: asLanding(formData.get("landing_page")), updated_at: now },
      { onConflict: "role" },
    );
  if (lErr) throw new Error(lErr.message);

  revalidatePath("/settings/permissions");
}

/** Save one employee's overrides. Empty/"inherit" values clear the override so
    the role default applies again. */
export async function saveUserPermissions(formData: FormData) {
  const employeeId = (formData.get("employee_id") ?? "").toString();
  if (!employeeId) throw new Error("No employee selected.");

  const supabase = await createClient();
  await requireModule("settings", "edit", { mode: "throw", supabase });

  const now = new Date().toISOString();
  const toUpsert: { employee_id: string; module: string; access: Access; updated_at: string }[] = [];
  const toClear: string[] = [];
  for (const moduleKey of MODULE_KEYS) {
    if (!isModuleKey(moduleKey)) continue;
    const access = asAccess(formData.get(`perm_${moduleKey}`));
    if (access) toUpsert.push({ employee_id: employeeId, module: moduleKey, access, updated_at: now });
    else toClear.push(moduleKey);
  }

  if (toUpsert.length) {
    const { error } = await supabase
      .from("employee_permissions")
      .upsert(toUpsert, { onConflict: "employee_id,module" });
    if (error) throw new Error(error.message);
  }
  if (toClear.length) {
    const { error } = await supabase
      .from("employee_permissions")
      .delete()
      .eq("employee_id", employeeId)
      .in("module", toClear);
    if (error) throw new Error(error.message);
  }

  const { error: lErr } = await supabase
    .from("employees")
    .update({ landing_page: asLanding(formData.get("landing_page")) })
    .eq("id", employeeId);
  if (lErr) throw new Error(lErr.message);

  revalidatePath("/settings/permissions");
}
