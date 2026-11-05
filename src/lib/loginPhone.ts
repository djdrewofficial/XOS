/* Keep auth.users.phone aligned with a staff or client record so phone OTP
   sign-in can find the login.

   An empty phone clears the auth phone only when an edit changes a real
   number to empty. Saving an unchanged empty phone must not wipe a number
   that was put on the login some other way.

   auth.users.phone is unique and is stored as digits with no leading "+".
   A collision never throws and never blocks the CRM save. A staff record
   may take the number off a client login; every other collision is skipped. */

export const PHONE_TAKEN_NOTICE =
  "That mobile number is already on another login, so text sign-in was left unchanged.";

export const PHONE_SYNC_FAILED_NOTICE = "Text sign-in could not be updated for that number.";

/* E.164: leading +, country code 1-9, then 7-14 more digits (8-15 total). */
const E164 = /^\+[1-9]\d{7,14}$/;

export type LoginPhoneSource = "staff" | "client";
export type LoginAccountType = "staff" | "client" | "event_guest";

export type PhoneOwner = {
  id: string;
  accountType: LoginAccountType | null;
};

export type NormalizePhone = (raw: string) => string | null;

export type SyncLoginPhoneDeps = {
  findByPhone: (e164: string) => Promise<PhoneOwner | null>;
  /** null clears the auth phone. */
  setPhone: (userId: string, phone: string | null) => Promise<{ error: string | null }>;
  normalize: NormalizePhone;
  log?: (message: string) => void;
};

export type SyncLoginPhoneArgs = {
  userId: string;
  phone: string | null | undefined;
  /**
   * Previous person-record phone. Omit on invite/resolve — an empty record
   * must not clear the login. Pass it on edits, including null or "" when
   * the field was already empty.
   */
  previousPhone?: string | null;
  source: LoginPhoneSource;
};

export type SyncLoginPhoneResult = {
  status: "updated" | "cleared" | "skipped";
  phone?: string | null;
  reason?: "invalid" | "unchanged_empty" | "empty" | "collision" | "no_login" | "error";
  notice?: string;
};

export function loginPhoneE164(raw: string | null | undefined, normalize: NormalizePhone): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const normalized = normalize(trimmed);
  if (!normalized || !E164.test(normalized)) return null;
  return normalized;
}

/** Attributes for auth.admin.updateUserById. The admin API takes E.164.
    GoTrue stores auth.users.phone as digits with no leading "+". A number
    is stored confirmed. Clearing does not use this payload. */
export function authPhoneUpdate(phone: string): { phone: string; phone_confirm: true } {
  return { phone, phone_confirm: true };
}

/** Digits only, so "13055550199" and "+1 305-555-0199" name the same login. */
export function authPhoneDigits(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

/** True when a stored auth.users.phone (digits, no "+") is the same number
    as an E.164 value. */
export function sameAuthPhone(stored: string | null | undefined, e164: string): boolean {
  const left = authPhoneDigits(stored);
  const right = authPhoneDigits(e164);
  return left != null && left === right;
}

type RpcError = { message: string } | null;

/** Enough of the service-role client to set or clear one login phone. */
export type AuthPhoneWriter = {
  auth: {
    admin: {
      updateUserById(
        userId: string,
        attributes: { phone: string; phone_confirm: true },
      ): Promise<{ error: RpcError }>;
    };
  };
  rpc(
    fn: "xos_clear_auth_phone",
    args: { p_user_id: string },
  ): PromiseLike<{ data: boolean | null; error: RpcError }>;
};

/** Set via updateUserById. Clear via public.xos_clear_auth_phone (migration
    00208), which the service-role client calls as rpc. A false return means
    no row changed (the login is already without a phone, or it is gone) and
    is not an error. An rpc error is. */
export async function writeAuthPhone(
  admin: AuthPhoneWriter,
  userId: string,
  phone: string | null,
): Promise<{ error: string | null }> {
  try {
    if (phone) {
      const { error } = await admin.auth.admin.updateUserById(userId, authPhoneUpdate(phone));
      return { error: error?.message ?? null };
    }
    const { error } = await admin.rpc("xos_clear_auth_phone", { p_user_id: userId });
    return { error: error?.message ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function blank(raw: string | null | undefined): boolean {
  return raw == null || String(raw).trim() === "";
}

function phoneTaken(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("phone") || m.includes("already registered") || m.includes("duplicate") || m.includes("unique");
}

export async function syncLoginPhone(
  args: SyncLoginPhoneArgs,
  deps: SyncLoginPhoneDeps,
): Promise<SyncLoginPhoneResult> {
  const log = (message: string) => {
    if (deps.log) deps.log(message);
    else console.warn(message);
  };

  if (!args.userId) return { status: "skipped", reason: "no_login" };

  const next = loginPhoneE164(args.phone, deps.normalize);
  if (!next) {
    if (!blank(args.phone)) return { status: "skipped", reason: "invalid" };
    /* Empty. Clear only when an edit removed a number we could have synced. */
    if (args.previousPhone === undefined) return { status: "skipped", reason: "empty" };
    if (!loginPhoneE164(args.previousPhone, deps.normalize)) {
      return { status: "skipped", reason: "unchanged_empty" };
    }
    const cleared = await writePhone(deps, args.userId, null);
    if (cleared.error) {
      log(`syncLoginPhone: could not clear sign-in number (${cleared.error})`);
      return { status: "skipped", reason: "error", notice: PHONE_SYNC_FAILED_NOTICE };
    }
    return { status: "cleared", phone: null };
  }

  let owner: PhoneOwner | null = null;
  try {
    owner = await deps.findByPhone(next);
  } catch (e) {
    log(`syncLoginPhone: lookup failed (${e instanceof Error ? e.message : String(e)}); trying the update anyway`);
  }

  if (owner && owner.id !== args.userId) {
    const staffTakesClient = args.source === "staff" && owner.accountType === "client";
    if (!staffTakesClient) {
      log(`syncLoginPhone: number already on another login (${owner.accountType ?? "unknown"}); skipped`);
      return { status: "skipped", reason: "collision", notice: PHONE_TAKEN_NOTICE };
    }
    const cleared = await writePhone(deps, owner.id, null);
    if (cleared.error) {
      log("syncLoginPhone: could not move number off a client login; skipped");
      return { status: "skipped", reason: "collision", notice: PHONE_TAKEN_NOTICE };
    }
    log("syncLoginPhone: moved number from a client login to a staff login");
  }

  const written = await writePhone(deps, args.userId, next);
  if (written.error) {
    if (phoneTaken(written.error)) {
      log("syncLoginPhone: number already on another login; skipped");
      return { status: "skipped", reason: "collision", notice: PHONE_TAKEN_NOTICE };
    }
    log(`syncLoginPhone: update failed (${written.error})`);
    return { status: "skipped", reason: "error", notice: PHONE_SYNC_FAILED_NOTICE };
  }
  return { status: "updated", phone: next };
}

async function writePhone(
  deps: SyncLoginPhoneDeps,
  userId: string,
  phone: string | null,
): Promise<{ error: string | null }> {
  try {
    const result = await deps.setPhone(userId, phone);
    return { error: result?.error ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
