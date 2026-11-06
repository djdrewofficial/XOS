/* Who may delete their login from the couple app, and in what order.
   Staff never. Event, client, and booking-agreement rows are not part of this. */

export type AppAccountType = "staff" | "client" | "event_guest" | null;

export type DeleteAppDecision =
  | { ok: false; status: 403; error: string }
  | { ok: true };

export function deleteAppAccountDecision(input: {
  accountType: AppAccountType;
  employeeId: string | null;
  linkedEmployee: boolean;
}): DeleteAppDecision {
  if (input.accountType === "staff" || input.employeeId || input.linkedEmployee) {
    return { ok: false, status: 403, error: "Staff accounts can't be deleted from the app." };
  }
  return { ok: true };
}

/** Staff is an accounts row of type staff, or an employee link. No row is not staff. */
export function staffAccessGranted(input: { accountType: string | null; employeeLinked: boolean }): boolean {
  return input.accountType === "staff" || input.employeeLinked;
}

/** Host access needs staff, a client link on that event, or a host membership. */
export function hostAccessGranted(input: { staff: boolean; clientOnEvent: boolean; hostMembership: boolean }): boolean {
  return input.staff || input.clientOnEvent || input.hostMembership;
}

/** Guest access needs a guest row or guest membership, and not staff or host access. */
export function guestAccessGranted(input: {
  staff: boolean;
  clientOnEvent: boolean;
  hostMembership: boolean;
  guestRecord: boolean;
  guestMembership: boolean;
}): boolean {
  if (hostAccessGranted(input)) return false;
  return input.guestRecord || input.guestMembership;
}

export function loginUsesApple(user: {
  app_metadata?: { provider?: string } | null;
  identities?: Array<{ provider?: string }> | null;
}): boolean {
  if (user.app_metadata?.provider === "apple") return true;
  return (user.identities ?? []).some((identity) => identity.provider === "apple");
}

/** Outcome line for the server log. Never include the code, token, or key. */
export function appleRevokeLog(input: {
  usedApple: boolean;
  hadCode: boolean;
  result: { ok: true } | { ok: false; error: string } | null;
}): string {
  if (!input.hadCode && !input.usedApple) return "Apple token revoke skipped: this login did not use Apple.";
  if (!input.hadCode) return "Apple token revoke skipped: no authorization code.";
  if (!input.result) return "Apple token revoke failed: Apple token revoke is not available.";
  if (input.result.ok) return "Apple token revoke succeeded.";
  return `Apple token revoke failed: ${input.result.error}`;
}

export function readAppleAuthorizationCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const code = (body as { appleAuthorizationCode?: unknown }).appleAuthorizationCode;
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  return trimmed || null;
}

export type AppleRevokeFn = (opts: {
  code: string;
  env: {
    APPLE_SIGNIN_KEY_ID?: string;
    APPLE_SIGNIN_PRIVATE_KEY?: string;
    APPLE_TEAM_ID?: string;
    APPLE_CLIENT_ID?: string;
  };
  nowSec?: number;
  fetchImpl?: typeof fetch;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

export async function runAppAccountDeletion(input: {
  accountType: AppAccountType;
  employeeId: string | null;
  linkedEmployee: boolean;
  appleAuthorizationCode: string | null;
  usedApple?: boolean;
  env: {
    APPLE_SIGNIN_KEY_ID?: string;
    APPLE_SIGNIN_PRIVATE_KEY?: string;
    APPLE_TEAM_ID?: string;
    APPLE_CLIENT_ID?: string;
  };
  nowSec?: number;
  fetchImpl?: typeof fetch;
  revoke?: AppleRevokeFn;
  log?: (message: string) => void;
  removeAppData: () => Promise<void>;
  deleteAuthUser: () => Promise<string | null>;
}): Promise<{ ok: true } | { ok: false; status: 403 | 500; error: string }> {
  const decision = deleteAppAccountDecision(input);
  if (!decision.ok) return decision;

  const hadCode = Boolean(input.appleAuthorizationCode);
  const usedApple = Boolean(input.usedApple) || hadCode;
  let appleResult: { ok: true } | { ok: false; error: string } | null = null;
  if (input.appleAuthorizationCode) {
    appleResult = { ok: false, error: "Apple token revoke is not available." };
    if (input.revoke) {
      try {
        appleResult = await input.revoke({
          code: input.appleAuthorizationCode,
          env: input.env,
          nowSec: input.nowSec,
          fetchImpl: input.fetchImpl,
        });
      } catch {
        appleResult = { ok: false, error: "Apple token revoke failed." };
      }
    }
  }
  input.log?.(appleRevokeLog({ usedApple, hadCode, result: appleResult }));

  try {
    await input.removeAppData();
  } catch (err) {
    input.log?.(err instanceof Error ? err.message : "Could not remove app membership.");
  }

  const authError = await input.deleteAuthUser();
  if (authError) return { ok: false, status: 500, error: "Could not delete the account. Please try again." };
  return { ok: true };
}
