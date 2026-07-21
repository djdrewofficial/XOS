/* Server-side identity + permissions. The one place that turns the signed-in
   Supabase user into { role, effective access per module, landing page }, and
   the guard helpers pages/actions use. Server-only (imports the server client). */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveAccessMap,
  accessAtLeast,
  defaultAccess,
  isOwnerEmail,
  DENY_ALL_ACCESS,
  DEFAULT_LANDING,
  type Access,
  type Role,
} from "@/lib/permissions";

type Client = SupabaseClient;

export type AccountType = "staff" | "client" | "event_guest";

export type Me = {
  userId: string;
  /** Which kind of user this is. Non-staff (client/event_guest) live in the
      planning portal and have no admin-screen access. */
  accountType: AccountType;
  employeeId: string | null;
  /** Staff permission tier (only meaningful when accountType === "staff"). */
  role: Role;
  /** Effective access per module key (master_admin = all "edit"). */
  can: Record<string, Access>;
  /** Where this person should land after login. */
  landing: string;
};

const NO_ACCESS: Record<string, Access> = {};

/** Load the current user with their resolved account type, role, permission map
    and landing. Client/Event-Guest accounts route to the portal with no admin
    access. Deny-by-default: a signed-in user with no employee row gets NO access
    (routed to /no-access) — the only exception is an OWNER_EMAILS break-glass
    match, which bootstraps master_admin so the owner can never be locked out.
    Returns null if not signed in. */
export async function getMe(supabase?: Client): Promise<Me | null> {
  const sb = supabase ?? (await createClient());
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  return resolveMe(sb, user);
}

/** getMe for a mobile (Bearer-token) request. The anon client carries the JWT in
    its Authorization header — so its RLS reads are user-scoped like a web session
    — but auth.getUser() needs the token passed explicitly (there's no stored
    session). Returns the same Me the web would resolve, or null if the token is
    invalid. Lets mobile routes reuse the exact web RBAC (see requireMobileStaffModule). */
export async function getMobileMe(supabase: Client, token: string): Promise<Me | null> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return resolveMe(supabase, data.user);
}

/** Resolve a signed-in user's account type, role, permission map and landing.
    Shared by getMe (web/cookie) and getMobileMe (mobile/Bearer) so both honor the
    identical RBAC. `user` is the already-authenticated auth user. */
async function resolveMe(sb: Client, user: { id: string; email?: string }): Promise<Me> {
  // accounts is the source of truth for who this login is.
  const { data: account } = await sb
    .from("accounts")
    .select("account_type, employee_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // External users (client / event guest) → portal, no admin screens.
  if (account && account.account_type !== "staff") {
    return {
      userId: user.id,
      accountType: account.account_type as AccountType,
      employeeId: null,
      role: "employee",
      can: NO_ACCESS,
      landing: "/portal",
    };
  }

  // Staff: resolve the employee + tier.
  const empQuery = account?.employee_id
    ? sb.from("employees").select("id, permission_tier, landing_page").eq("id", account.employee_id)
    : sb.from("employees").select("id, permission_tier, landing_page").eq("auth_user_id", user.id);
  const { data: emp } = await empQuery.maybeSingle();

  // No employee row → this user has no staff identity. DENY by default. The one
  // exception is a configured owner email (OWNER_EMAILS), which break-glass
  // bootstraps master_admin so the owner can't be locked out of their own app.
  if (!emp) {
    if (isOwnerEmail(user.email)) {
      return {
        userId: user.id,
        accountType: "staff",
        employeeId: null,
        role: "master_admin",
        can: resolveAccessMap("master_admin", [], []),
        landing: DEFAULT_LANDING.master_admin,
      };
    }
    return {
      userId: user.id,
      accountType: "staff",
      employeeId: null,
      role: "employee",
      can: DENY_ALL_ACCESS,
      landing: "/no-access",
    };
  }

  const role = emp.permission_tier as Role;
  const employeeId = emp.id as string;

  if (role === "master_admin") {
    return {
      userId: user.id,
      accountType: "staff",
      employeeId,
      role,
      can: resolveAccessMap(role, [], []),
      landing: emp?.landing_page || DEFAULT_LANDING.master_admin,
    };
  }

  const [{ data: roleRows }, { data: userRows }] = await Promise.all([
    sb.from("role_permissions").select("module, access").eq("role", role),
    employeeId
      ? sb.from("employee_permissions").select("module, access").eq("employee_id", employeeId)
      : Promise.resolve({ data: [] as { module: string; access: Access }[] }),
  ]);

  const can = resolveAccessMap(
    role,
    (roleRows ?? []) as { module: string; access: Access }[],
    (userRows ?? []) as { module: string; access: Access }[],
  );

  const landing = await resolveLanding(sb, role, emp?.landing_page ?? null);
  return { userId: user.id, accountType: "staff", employeeId, role, can, landing };
}

/** Per-user override → role default → hardcoded fallback. */
async function resolveLanding(
  sb: Client,
  role: Role,
  userLanding: string | null,
): Promise<string> {
  if (userLanding) return userLanding;
  const { data } = await sb
    .from("role_settings")
    .select("landing_page")
    .eq("role", role)
    .maybeSingle();
  return data?.landing_page || DEFAULT_LANDING[role] || "/";
}

/** Effective access for a single module for the current user. */
export async function moduleAccess(moduleKey: string, supabase?: Client): Promise<Access> {
  const me = await getMe(supabase);
  if (!me) return "none";
  return me.can[moduleKey] ?? defaultAccess(me.role, moduleKey);
}

/** Guard a server action so only the master admin (owner) can run it. Throws
    otherwise. Use for privilege-sensitive actions (editing permission tiers,
    the permission grid, etc.) that RBAC modules don't adequately protect. */
export async function requireMaster(supabase?: Client): Promise<void> {
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff" || me.role !== "master_admin") {
    throw new Error("Not authorized.");
  }
}

/** Guard a page or server action: redirect (pages) / throw (actions) unless the
    current user has at least `need` access to `moduleKey`. */
export async function requireModule(
  moduleKey: string,
  need: Access = "view",
  opts: { mode?: "redirect" | "throw"; supabase?: Client } = {},
): Promise<void> {
  const me = await getMe(opts.supabase);
  const have = me?.can[moduleKey] ?? "none";
  if (me && accessAtLeast(have, need)) return;
  if (opts.mode === "throw") throw new Error("Not authorized.");
  redirect(me ? me.landing : "/login");
}
