import { createClient } from "@/lib/supabase/server";
import Tabs from "@/components/Tabs";
import SaveButton from "@/components/SaveButton";
import UserPermissionEditor from "@/components/UserPermissionEditor";
import { requireModule } from "@/lib/auth";
import {
  MODULES,
  ROLES,
  LANDING_PAGES,
  defaultAccess,
  DEFAULT_LANDING,
  type Access,
  type Role,
} from "@/lib/permissions";
import { saveRolePermissions, saveUserPermissions } from "./actions";

export const dynamic = "force-dynamic";

const TIER_LABELS: Record<string, string> = {
  master_admin: "Master Admin",
  admin: "Admin",
  salesperson: "Salesperson",
  employee: "Employee",
};

export default async function PermissionsPage() {
  const supabase = await createClient();
  await requireModule("settings", "edit", { supabase });

  // Probe the table — show the setup card if migration 00066 hasn't run yet.
  const { data: roleRows, error } = await supabase
    .from("role_permissions")
    .select("role, module, access");

  if (error) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Permissions</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
              supabase/migrations/00066_permissions.sql
            </code>{" "}
            in the Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const [{ data: roleSettings }, { data: employees }, { data: empPerms }] = await Promise.all([
    supabase.from("role_settings").select("role, landing_page"),
    supabase
      .from("employees")
      .select("id, first_name, last_name, permission_tier, landing_page")
      .eq("is_active", true)
      .order("first_name"),
    supabase.from("employee_permissions").select("employee_id, module, access"),
  ]);

  // Effective role grids (DB row → fallback) for both the role forms and the
  // "inherit" labels in the per-user editor.
  const roleAccess = (role: Role, module: string): Access =>
    ((roleRows ?? []).find((r) => r.role === role && r.module === module)?.access as Access) ??
    defaultAccess(role, module);

  const roleLandingFor = (role: Role): string =>
    (roleSettings ?? []).find((r) => r.role === role)?.landing_page || DEFAULT_LANDING[role] || "/";

  const roleDefaults: Record<string, Record<string, Access>> = {};
  const roleLanding: Record<string, string> = {};
  for (const [role] of ROLES) {
    roleDefaults[role] = Object.fromEntries(MODULES.map((m) => [m.key, roleAccess(role, m.key)]));
    roleLanding[role] = roleLandingFor(role);
  }

  // Per-user overrides keyed by employee id.
  const overrides: Record<string, { perms: Record<string, Access>; landing: string | null }> = {};
  for (const e of employees ?? []) {
    overrides[e.id] = { perms: {}, landing: e.landing_page ?? null };
  }
  for (const p of empPerms ?? []) {
    (overrides[p.employee_id] ??= { perms: {}, landing: null }).perms[p.module] = p.access as Access;
  }

  const subjects = (employees ?? []).map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name}`.trim(),
    role: e.permission_tier,
    roleLabel: TIER_LABELS[e.permission_tier] ?? e.permission_tier,
  }));

  /* ---------- one role's access grid + landing form ---------- */
  const roleForm = (role: Role) => {
    if (role === "master_admin") {
      return (
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-1 font-semibold text-zinc-800 dark:text-zinc-200">
            Master Admin has full access to everything.
          </p>
          <p>
            This is locked on purpose so you can never remove your own access. Use the other roles —
            or the <strong>By User</strong> tab — to restrict specific people.
          </p>
        </div>
      );
    }
    return (
      <form action={saveRolePermissions.bind(null, role)} className="space-y-5">
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-sm font-semibold text-white">
            Screen Access — {TIER_LABELS[role]}
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-white/[0.05]">
            {MODULES.map((m) => (
              <div key={m.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm text-zinc-700 dark:text-zinc-300">{m.label}</span>
                <select
                  name={`perm_${m.key}`}
                  defaultValue={roleAccess(role, m.key)}
                  className="input w-44"
                >
                  <option value="none">No access</option>
                  <option value="view">View (read-only)</option>
                  <option value="edit">Edit (read &amp; write)</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-sm font-semibold text-white">
            Landing Screen After Login
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              {TIER_LABELS[role]}s land on
            </span>
            <select name="landing_page" defaultValue={roleLandingFor(role)} className="input w-56">
              {LANDING_PAGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <SaveButton>Save {TIER_LABELS[role]}</SaveButton>
        </div>
      </form>
    );
  };

  const byRoleTab = (
    <Tabs
      tabs={ROLES.map(([role, label]) => ({
        id: role,
        label,
        content: roleForm(role),
      }))}
    />
  );

  const byUserTab = (
    <UserPermissionEditor
      employees={subjects}
      modules={MODULES.map((m) => ({ key: m.key, label: m.label }))}
      landingPages={LANDING_PAGES}
      roleDefaults={roleDefaults}
      roleLanding={roleLanding}
      overrides={overrides}
      action={saveUserPermissions}
    />
  );

  return (
    <div className="max-w-4xl">
      <h1 className="page-title mb-2">Permissions</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Control which screens each role can reach — <strong>View</strong> is read-only,{" "}
        <strong>Edit</strong> allows changes, <strong>No access</strong> hides the screen and blocks
        the URL. Override any individual person on the <strong>By User</strong> tab, and set where
        each role or person lands after logging in.
      </p>
      <Tabs
        tabs={[
          { id: "roles", label: "By Role", content: byRoleTab },
          { id: "users", label: "By User", badge: subjects.length, content: byUserTab },
        ]}
      />
    </div>
  );
}
