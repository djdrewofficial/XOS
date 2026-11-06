/* Decisions for a signed-in password change. GoTrue is the real enforcer
   (strength, leaked-password list, secure-password-change nonce, AAL2 when
   MFA is on). These helpers only choose the next step and the message so the
   account page and the reset page stay in lockstep. */

export const PASSWORD_CHANGE_NONCE_PROMPT =
  "We emailed you a confirmation code. Enter it below to finish changing your password.";

export const PASSWORD_CHANGE_MFA_PROMPT =
  "Enter a 6-digit code from your authenticator app, a text message, or the email we send you.";

export type AuthErrorLike = {
  code?: string | null;
  message?: string | null;
};

export type AalSnapshot = {
  currentLevel?: string | null;
  nextLevel?: string | null;
} | null;

/** Empty when `code` is six digits. */
export function totpCodeError(code: string): string | null {
  if (!/^\d{6}$/.test((code ?? "").trim())) return PASSWORD_CHANGE_MFA_PROMPT;
  return null;
}

/** Recovery and a borrowed aal1 session cannot change the password until the
    authenticator step is done. An aal2 session does not need it again. */
export function needsAuthenticatorStepUp(aal: AalSnapshot): boolean {
  return aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
}

/** Whether updateUser will refuse a password change until the session is aal2.
    The assurance snapshot is enough when the session user lists a verified
    factor (nextLevel aal2). A recovery session is sometimes only aal1 with the
    factor list missing, so a verified factor from listFactors counts too.
    No factor, or a session that is already aal2, means leave the flow alone. */
export function sessionNeedsTotpBeforePasswordChange(input: {
  aal: AalSnapshot;
  hasVerifiedTotp: boolean;
}): boolean {
  if (input.aal?.currentLevel === "aal2") return false;
  if (needsAuthenticatorStepUp(input.aal)) return true;
  return input.hasVerifiedTotp;
}

export function isInsufficientAal(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toLowerCase();
  if (code === "insufficient_aal" || code === "aal_not_satisfied") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("aal2") || msg.includes("assurance level");
}

/** A nonce was sent and the one they typed was rejected. */
export function isInvalidNonce(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toLowerCase();
  if (code === "invalid_nonce" || code === "otp_expired") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("invalid nonce") || msg.includes("expired nonce") || msg.includes("nonce is invalid");
}

/** Secure password change is on and this session is past the reauth window.
    The fix is reauthenticate() plus the emailed nonce — a fresh
    signInWithPassword does not satisfy it, and on an aal2 session it would
    replace the cookie with an aal1 session. */
export function isReauthenticationNeeded(error: AuthErrorLike | null | undefined): boolean {
  if (!error || isInvalidNonce(error)) return false;
  const code = (error.code ?? "").toLowerCase();
  if (code === "reauthentication_needed" || code === "reauthentication_required") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("reauthentication") || msg.includes("nonce is required") || msg.includes("requires a nonce");
}

export type CurrentPasswordCheck = "match" | "wrong" | "rate_limited" | "unavailable";

/** Classify a throwaway signInWithPassword error. weak_password means the
    password matched and GoTrue then refused to mint a session because it no
    longer meets the strength rules — the person still proved they know it. */
export function classifyCurrentPasswordError(error: AuthErrorLike | null | undefined): CurrentPasswordCheck {
  if (!error) return "match";
  const code = (error.code ?? "").toLowerCase();
  if (code === "weak_password") return "match";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return "rate_limited";
  const msg = (error.message ?? "").toLowerCase();
  if (
    code === "invalid_credentials" ||
    code === "invalid_grant" ||
    msg.includes("invalid login credentials") ||
    msg.includes("invalid email or password")
  ) {
    return "wrong";
  }
  return "unavailable";
}

export function currentPasswordErrorMessage(
  kind: Exclude<CurrentPasswordCheck, "match">,
  error?: AuthErrorLike | null,
): string {
  if (kind === "wrong") return "Current password is incorrect.";
  if (kind === "rate_limited") return "Too many attempts. Wait a few minutes and try again.";
  return error?.message || "Couldn't verify your current password. Try again.";
}

export function passwordUpdateErrorMessage(error: AuthErrorLike): string {
  const code = (error.code ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();
  if (isInsufficientAal(error)) return PASSWORD_CHANGE_MFA_PROMPT;
  if (code === "same_password" || msg.includes("different from the old")) {
    return "Choose a password that's different from your current one.";
  }
  if (code === "weak_password") return error.message || "That password isn't strong enough.";
  if (isInvalidNonce(error)) return "That confirmation code didn't work. Request a new one and try again.";
  if (msg.includes("current password")) return "Current password is incorrect.";
  return error.message || "Couldn't update your password.";
}

export type PasswordChangeStep =
  | { action: "send-nonce" }
  | { action: "step-up-mfa" }
  | { action: "fail"; error: string };

/** What to do after updateUser rejects a password change. */
export function nextPasswordChangeStep(input: {
  error: AuthErrorLike;
  hasNonce: boolean;
}): PasswordChangeStep {
  if (isInsufficientAal(input.error)) return { action: "step-up-mfa" };
  if (isReauthenticationNeeded(input.error)) {
    if (input.hasNonce) {
      return {
        action: "fail",
        error: "That confirmation code didn't work. Request a new one and try again.",
      };
    }
    return { action: "send-nonce" };
  }
  return { action: "fail", error: passwordUpdateErrorMessage(input.error) };
}
