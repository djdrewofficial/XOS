/* Server adapter for syncLoginPhone. Uses the service-role admin client.
   Never import this into a client component. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { toE164 } from "@/lib/phone";
import {
  sameAuthPhone,
  syncLoginPhone,
  writeAuthPhone,
  type LoginAccountType,
  type SyncLoginPhoneResult,
} from "@/lib/loginPhone";

type Admin = SupabaseClient;

function isAccountType(value: string | null | undefined): value is LoginAccountType {
  return value === "staff" || value === "client" || value === "event_guest";
}

async function accountTypeOf(admin: Admin, userId: string): Promise<LoginAccountType | null> {
  const { data } = await admin.from("accounts").select("account_type").eq("auth_user_id", userId).maybeSingle();
  const type = (data?.account_type as string | null | undefined) ?? null;
  return isAccountType(type) ? type : null;
}

async function findByPhone(admin: Admin, e164: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    /* auth.users.phone is digits with no leading "+". sameAuthPhone matches
       that form and an E.164 value from the person record. */
    const match = data.users.find((user) => sameAuthPhone(user.phone, e164));
    if (match) return { id: match.id, accountType: await accountTypeOf(admin, match.id) };
    if (data.users.length < 200) return null;
  }
  return null;
}

/* Setting uses updateUserById. Clearing calls xos_clear_auth_phone on the
   service-role client. GoTrue ignores a blank phone, so there is no
   temporary session and no identity unlink. */
async function applyAuthPhone(admin: Admin, userId: string, phone: string | null): Promise<{ error: string | null }> {
  return writeAuthPhone(admin, userId, phone);
}

export async function syncPersonLoginPhone(
  admin: Admin,
  args: {
    userId: string | null | undefined;
    phone: string | null | undefined;
    previousPhone?: string | null;
    source: "staff" | "client";
  },
): Promise<SyncLoginPhoneResult> {
  if (!args.userId) return { status: "skipped", reason: "no_login" };
  return syncLoginPhone(
    {
      userId: args.userId,
      phone: args.phone,
      previousPhone: args.previousPhone,
      source: args.source,
    },
    {
      normalize: toE164,
      findByPhone: (e164) => findByPhone(admin, e164),
      setPhone: (userId, phone) => applyAuthPhone(admin, userId, phone),
      log: (message) => console.warn(message),
    },
  );
}

async function staffAuthUserId(admin: Admin, employeeId: string): Promise<string | null> {
  const { data: account } = await admin
    .from("accounts")
    .select("auth_user_id")
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (account?.auth_user_id) return account.auth_user_id as string;
  const { data: employee } = await admin.from("employees").select("auth_user_id").eq("id", employeeId).maybeSingle();
  return (employee?.auth_user_id as string | null | undefined) ?? null;
}

async function clientAuthUserId(admin: Admin, clientId: string): Promise<string | null> {
  const { data } = await admin.from("accounts").select("auth_user_id").eq("client_id", clientId).maybeSingle();
  return (data?.auth_user_id as string | null | undefined) ?? null;
}

export async function syncEmployeeLoginPhone(
  employeeId: string,
  phone: string | null,
  previousPhone: string | null,
): Promise<SyncLoginPhoneResult> {
  try {
    const admin = createAdminClient();
    const userId = await staffAuthUserId(admin, employeeId);
    return syncPersonLoginPhone(admin, { userId, phone, previousPhone, source: "staff" });
  } catch (e) {
    console.warn("syncLoginPhone failed", e instanceof Error ? e.message : e);
    return { status: "skipped", reason: "error" };
  }
}

export async function syncClientLoginPhone(
  clientId: string,
  phone: string | null,
  previousPhone: string | null,
): Promise<SyncLoginPhoneResult> {
  try {
    const admin = createAdminClient();
    const userId = await clientAuthUserId(admin, clientId);
    return syncPersonLoginPhone(admin, { userId, phone, previousPhone, source: "client" });
  } catch (e) {
    console.warn("syncLoginPhone failed", e instanceof Error ? e.message : e);
    return { status: "skipped", reason: "error" };
  }
}

/** After resolveLogin: copy the person record's phone onto the login.
    Does not clear — an empty employees.phone / clients.cell_phone must not
    wipe a number already on the auth user. event_guests have no phone. */
export async function syncSubjectLoginPhone(
  admin: Admin,
  subject: { type: "staff" | "client" | "event_guest"; employeeId?: string; clientId?: string },
  userId: string,
): Promise<string | undefined> {
  if (subject.type === "event_guest") return;
  try {
    if (subject.type === "staff") {
      if (!subject.employeeId) return;
      const { data } = await admin.from("employees").select("phone").eq("id", subject.employeeId).maybeSingle();
      const result = await syncPersonLoginPhone(admin, {
        userId,
        phone: (data?.phone as string | null | undefined) ?? null,
        source: "staff",
      });
      return result.notice;
    }
    if (!subject.clientId) return;
    const { data } = await admin.from("clients").select("cell_phone").eq("id", subject.clientId).maybeSingle();
    const result = await syncPersonLoginPhone(admin, {
      userId,
      phone: (data?.cell_phone as string | null | undefined) ?? null,
      source: "client",
    });
    return result.notice;
  } catch (e) {
    console.warn("syncLoginPhone failed", e instanceof Error ? e.message : e);
    return;
  }
}
