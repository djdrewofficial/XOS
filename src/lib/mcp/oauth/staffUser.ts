import type { SupabaseClient } from "@supabase/supabase-js";
import { isOwnerEmail, resolveAccessMap, type Access, type Role } from "@/lib/permissions";
import { ROLES } from "@/lib/dashboardWidgets";
import { mcpScopesFromAccess, mcpScopesForRole } from "./roleScopes";

const ROLE_IDS = new Set<string>(ROLES.map(([id]) => id));

function isRole(value: string | null | undefined): value is Role {
  return !!value && ROLE_IDS.has(value);
}

/** Resolve the signed-in staff member for MCP OAuth (display name + live scopes). */
export async function resolveOAuthStaffUser(
  admin: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<{ userId: string; displayName: string; scopes: string[]; role: Role } | null> {
  const { data: emp } = await admin
    .from("employees")
    .select("id, first_name, last_name, email, permission_tier")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  let role: Role | null = emp && isRole(emp.permission_tier as string) ? (emp.permission_tier as Role) : null;
  if (!role && isOwnerEmail(user.email)) role = "master_admin";
  if (!role) return null;

  let can: Record<string, Access> | undefined;
  if (role === "master_admin") {
    can = resolveAccessMap(role, [], []);
  } else if (emp?.id) {
    const [{ data: roleRows }, { data: userRows }] = await Promise.all([
      admin.from("role_permissions").select("module, access").eq("role", role),
      admin.from("employee_permissions").select("module, access").eq("employee_id", emp.id),
    ]);
    can = resolveAccessMap(
      role,
      (roleRows ?? []) as { module: string; access: Access }[],
      (userRows ?? []) as { module: string; access: Access }[],
    );
  }

  const scopes = can ? mcpScopesFromAccess(can) : mcpScopesForRole(role);
  const nameFromEmp = emp
    ? [emp.first_name, emp.last_name].filter(Boolean).join(" ").trim()
    : "";
  const displayName = nameFromEmp || (emp?.email as string) || user.email || "Staff";

  return { userId: user.id, displayName, scopes, role };
}

/** Live scope refresh for an already-connected OAuth user id. */
export async function liveMcpScopesForUser(admin: SupabaseClient, userId: string): Promise<string[] | null> {
  const { data: emp } = await admin
    .from("employees")
    .select("id, permission_tier")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!emp || !isRole(emp.permission_tier as string)) return null;
  const role = emp.permission_tier as Role;
  if (role === "master_admin") return mcpScopesForRole(role);
  const [{ data: roleRows }, { data: userRows }] = await Promise.all([
    admin.from("role_permissions").select("module, access").eq("role", role),
    admin.from("employee_permissions").select("module, access").eq("employee_id", emp.id),
  ]);
  return mcpScopesFromAccess(
    resolveAccessMap(
      role,
      (roleRows ?? []) as { module: string; access: Access }[],
      (userRows ?? []) as { module: string; access: Access }[],
    ),
  );
}
