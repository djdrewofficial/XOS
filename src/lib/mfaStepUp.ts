import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionNeedsTotpBeforePasswordChange, totpCodeError } from "./passwordChange";

/** True when this session must complete the /2fa challenge before a password
    update will be accepted. A lookup failure does not block accounts that
    have no authenticator — the update itself still reports a real refusal. */
export async function passwordChangeNeedsTotp(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") return false;
    if (sessionNeedsTotpBeforePasswordChange({ aal, hasVerifiedTotp: false })) return true;
    const { data: factors, error } = await supabase.auth.mfa.listFactors();
    if (error) return false;
    const hasVerifiedTotp = Boolean(factors?.totp?.some((f) => f.status === "verified"));
    return sessionNeedsTotpBeforePasswordChange({ aal, hasVerifiedTotp });
  } catch {
    return false;
  }
}

/** Raise the current session from aal1 to aal2 with a text-message factor.
    The challenge has to be created first — that send is what delivers the code.
    Returns an error string, or null when the session is now aal2. */
export async function elevateSessionWithPhone(
  supabase: SupabaseClient,
  input: { factorId: string; challengeId: string; code: string },
): Promise<string | null> {
  if (!/^\d{6}$/.test((input.code ?? "").trim())) return "Enter the 6-digit code from the text message.";
  const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
  if (listErr) return listErr.message;
  const factor = factors?.phone?.find((f) => f.id === input.factorId && f.status === "verified");
  if (!factor) return "No text-message verification is enrolled on this account.";
  const { error } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: input.challengeId,
    code: input.code.trim(),
  });
  return error ? error.message : null;
}

/** Raise the current session from aal1 to aal2 with the enrolled TOTP factor.
    Same challenge + verify the /2fa page uses. Returns an error string, or
    null when the session is now aal2. */
export async function elevateSessionWithTotp(supabase: SupabaseClient, code: string): Promise<string | null> {
  const format = totpCodeError(code);
  if (format) return format;
  const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
  if (listErr) return listErr.message;
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) return "No authenticator is enrolled on this account.";
  const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (challengeErr || !challenge) return challengeErr?.message ?? "Could not verify the authenticator code.";
  const { error: verifyErr } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: code.trim(),
  });
  return verifyErr ? verifyErr.message : null;
}
