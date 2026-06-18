/* XOS permissions registry — the single source of truth for the app's screens
   ("modules"), how routes map to them, the per-role default access grid, and the
   pure resolver that turns (role defaults + user overrides) into an effective
   access level. Safe to import from client, server, AND middleware (edge): no
   Node/Supabase imports here. */

import { ROLES, type Role } from "@/lib/dashboardWidgets";

export { ROLES, type Role };

export type Access = "none" | "view" | "edit";

/** Ordered so "edit" implies "view" implies "none". */
const ACCESS_RANK: Record<Access, number> = { none: 0, view: 1, edit: 2 };

/** True when `have` grants at least `need` (e.g. edit satisfies a view check). */
export function accessAtLeast(have: Access, need: Access): boolean {
  return ACCESS_RANK[have] >= ACCESS_RANK[need];
}

export type ModuleDef = {
  key: string;
  label: string;
  /** Route prefixes this screen owns. The home route "/" is matched exactly. */
  routes: string[];
};

/* The screens guarded by permissions. Order here drives the editor's row order. */
export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", routes: ["/"] },
  { key: "inbox", label: "Inbox", routes: ["/inbox"] },
  { key: "events", label: "Events", routes: ["/events"] },
  { key: "clients", label: "Clients", routes: ["/clients"] },
  { key: "documents", label: "Documents", routes: ["/documents"] },
  { key: "venues", label: "Venues", routes: ["/venues"] },
  { key: "vendors", label: "Vendors", routes: ["/vendors"] },
  { key: "packages", label: "Packages", routes: ["/packages"] },
  { key: "equipment", label: "Equipment", routes: ["/equipment"] },
  { key: "employees", label: "Employees", routes: ["/employees"] },
  { key: "payments", label: "Payments & Money", routes: ["/payments"] },
  { key: "commissions", label: "Sales & Commissions", routes: ["/commissions"] },
  { key: "payroll", label: "Payroll", routes: ["/payroll"] },
  { key: "reports", label: "Reports", routes: ["/reports"] },
  { key: "settings", label: "Settings", routes: ["/settings"] },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
const MODULE_KEY_SET = new Set(MODULE_KEYS);

export function isModuleKey(key: string): boolean {
  return MODULE_KEY_SET.has(key);
}

/** Map a pathname to the module that owns it, or null if it isn't guarded
    (e.g. /api/*, /search, /profile — those fall through to plain auth). */
export function moduleForPath(pathname: string): string | null {
  if (pathname === "/") return "dashboard";
  // Longest matching prefix wins (none currently overlap, but be safe).
  let best: { key: string; len: number } | null = null;
  for (const m of MODULES) {
    for (const r of m.routes) {
      if (r === "/") continue;
      if (pathname === r || pathname.startsWith(`${r}/`)) {
        if (!best || r.length > best.len) best = { key: m.key, len: r.length };
      }
    }
  }
  return best?.key ?? null;
}

/* Screens offered as a "land here after login" choice (must be a real page a
   role could be granted). */
export const LANDING_PAGES: ReadonlyArray<readonly [string, string]> = [
  ["/", "Dashboard"],
  ["/inbox", "Inbox"],
  ["/events", "Events List"],
  ["/events/new", "Add Event"],
  ["/clients", "Clients"],
  ["/documents", "Documents"],
  ["/payments", "Payments"],
  ["/payroll", "Payroll"],
] as const;

/* Hardcoded fallback grid — mirrors migration 00066's seed so the app behaves
   sanely even before the tables are populated. master_admin is intentionally
   omitted: it is always full access (see resolveAccess / getMe). */
export const DEFAULT_ROLE_PERMISSIONS: Record<
  Exclude<Role, "master_admin">,
  Record<string, Access>
> = {
  admin: Object.fromEntries(MODULE_KEYS.map((k) => [k, "edit"])) as Record<string, Access>,
  salesperson: {
    dashboard: "edit", inbox: "edit", events: "edit", clients: "edit", documents: "edit",
    venues: "view", vendors: "view", packages: "view", equipment: "view", employees: "view",
    payments: "view", commissions: "view", payroll: "none", reports: "view", settings: "none",
  },
  employee: {
    dashboard: "view", inbox: "view", events: "view", clients: "none", documents: "none",
    venues: "view", vendors: "none", packages: "none", equipment: "view", employees: "none",
    payments: "none", commissions: "none", payroll: "none", reports: "none", settings: "none",
  },
};

export const DEFAULT_LANDING: Record<Role, string> = {
  master_admin: "/",
  admin: "/",
  salesperson: "/events",
  employee: "/",
};

/** Default access for a role+module, before DB rows / user overrides. */
export function defaultAccess(role: Role, moduleKey: string): Access {
  if (role === "master_admin") return "edit";
  return DEFAULT_ROLE_PERMISSIONS[role]?.[moduleKey] ?? "none";
}

/** Build the effective access map for a subject from the raw DB rows.
    `roleRows` = this role's role_permissions; `userRows` = this employee's
    employee_permissions (overrides). Master Admin short-circuits to full edit. */
export function resolveAccessMap(
  role: Role,
  roleRows: ReadonlyArray<{ module: string; access: Access }>,
  userRows: ReadonlyArray<{ module: string; access: Access }> = [],
): Record<string, Access> {
  if (role === "master_admin") {
    return Object.fromEntries(MODULE_KEYS.map((k) => [k, "edit"])) as Record<string, Access>;
  }
  const roleMap = new Map(roleRows.map((r) => [r.module, r.access]));
  const userMap = new Map(userRows.map((r) => [r.module, r.access]));
  const out: Record<string, Access> = {};
  for (const key of MODULE_KEYS) {
    out[key] = userMap.get(key) ?? roleMap.get(key) ?? defaultAccess(role, key);
  }
  return out;
}
