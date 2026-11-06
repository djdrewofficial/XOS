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

  if (input.appleAuthorizationCode) {
    let result: { ok: true } | { ok: false; error: string } = {
      ok: false,
      error: "Apple token revoke is not available.",
    };
    if (input.revoke) {
      try {
        result = await input.revoke({
          code: input.appleAuthorizationCode,
          env: input.env,
          nowSec: input.nowSec,
          fetchImpl: input.fetchImpl,
        });
      } catch {
        result = { ok: false, error: "Apple token revoke failed." };
      }
    }
    if (!result.ok) input.log?.(`Apple token revoke failed: ${result.error}`);
  }

  try {
    await input.removeAppData();
  } catch (err) {
    input.log?.(err instanceof Error ? err.message : "Could not remove app membership.");
  }

  const authError = await input.deleteAuthUser();
  if (authError) return { ok: false, status: 500, error: "Could not delete the account. Please try again." };
  return { ok: true };
}
