import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingEmailMfaSchema } from "@/lib/emailMfa";
import { MFA_EMAIL_COOKIE, readMfaEmailStepUp } from "@/lib/mfaStepUpCookie";
import {
  factorBucket,
  isMissingPasskeySchema,
  type AuthMethodCounts,
} from "@/lib/passkey";
import { MFA_PASSKEY_COOKIE, readMfaPasskeyStepUp } from "@/lib/passkeyStepUpCookie";
import { permCacheSecret } from "@/lib/permSnapshot";

/** A session that already finished a passkey or a second factor. */
export async function sessionIsStrong(input: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string | null;
}): Promise<boolean> {
  try {
    const { data: aal } = await input.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") return true;
  } catch {
    // Cookie proofs still count when the assurance lookup is down.
  }
  const secret = permCacheSecret();
  const jar = await cookies();
  if (await readMfaEmailStepUp(jar.get(MFA_EMAIL_COOKIE)?.value, secret, input.userId, input.sessionId)) return true;
  return readMfaPasskeyStepUp(jar.get(MFA_PASSKEY_COOKIE)?.value, secret, input.userId, input.sessionId);
}

export async function loadAuthMethods(input: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  emailFlag: boolean;
}): Promise<{ ok: true; methods: AuthMethodCounts } | { ok: false; error: string }> {
  const [factors, passkeys, email] = await Promise.all([
    input.supabase.auth.mfa.listFactors(),
    input.admin.from("staff_passkeys").select("id", { count: "exact", head: true }).eq("user_id", input.userId),
    input.admin.from("staff_email_mfa").select("user_id").eq("user_id", input.userId).maybeSingle(),
  ]);

  if (factors.error) return { ok: false, error: "Couldn't check your verification methods. Try again." };
  if (passkeys.error && !isMissingPasskeySchema(passkeys.error.message)) {
    return { ok: false, error: "Couldn't check passkeys. Try again." };
  }
  if (email.error && !isMissingEmailMfaSchema(email.error.message)) {
    return { ok: false, error: "Couldn't check email verification. Try again." };
  }

  const counts: AuthMethodCounts = { passkeys: passkeys.error ? 0 : (passkeys.count ?? 0), totp: 0, phone: 0, email: 0, otherFactors: 0 };
  for (const factor of factors.data?.all ?? []) {
    if (factor.status !== "verified") continue;
    counts[factorBucket(factor.factor_type)] += 1;
  }
  const emailOn = email.error ? input.emailFlag : Boolean(email.data) || input.emailFlag;
  counts.email = emailOn ? 1 : 0;
  return { ok: true, methods: counts };
}
