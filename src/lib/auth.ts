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
    access. A signed-in user with no account row is treated as the owner
    (master_admin) so Drew can never lock himself out. Returns null if not signed in. */
export async function getMe(supabase?: Client): Promise<Me | null> {
  const sb = supabase ?? (await createClient());
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;

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

  // Staff (or no account row → owner fallback): resolve the employee + tier.
  const empQuery = account?.employee_id
    ? sb.from("employees").select("id, permission_tier, landing_page").eq("id", account.employee_id)
    : sb.from("employees").select("id, permission_tier, landing_page").eq("auth_user_id", user.id);
  const { data: emp } = await empQuery.maybeSingle();

  const role = ((emp?.permission_tier as Role | undefined) ?? "master_admin") as Role;
  const employeeId = (emp?.id as string | undefined) ?? null;

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
