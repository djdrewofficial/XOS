import { createHmac } from "node:crypto";

/** Keep these next to supabase/migrations/00209_staff_email_mfa.sql. */
export const EMAIL_MFA_TTL_MS = 10 * 60 * 1000;
export const EMAIL_MFA_MAX_ATTEMPTS = 5;
export const EMAIL_MFA_RESEND_MS = 60 * 1000;
export const EMAIL_MFA_MAX_SENDS_PER_HOUR = 5;
export const EMAIL_MFA_SUBJECT = "Your XOS verification code";

export const EMAIL_MFA_LOG_HTML =
  "<p>A two-factor code was sent to this address. The code is not stored in XOS.</p>";

export type EmailMfaPurpose = "enroll" | "signin";

export function isEmailMfaPurpose(value: unknown): value is EmailMfaPurpose {
  return value === "enroll" || value === "signin";
}

/** `nextInt` returns an integer in [0, maxExclusive). */
export function generateEmailMfaCode(nextInt: (maxExclusive: number) => number): string {
  const n = nextInt(1_000_000);
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000) throw new Error("bad rng");
  return n.toString().padStart(6, "0");
}

/** HMAC so a database read cannot be replayed as the code. */
export function hashEmailMfaCode(code: string, pepper: string): string {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) throw new Error("code");
  if (pepper.length < 16) throw new Error("pepper");
  return createHmac("sha256", pepper).update(trimmed).digest("hex");
}

export function emailMfaContentHtml(code: string): string {
  if (!/^\d{6}$/.test(code)) throw new Error("code");
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#2c2c33;">Your XOS verification code is</p>
<p style="margin:0 0 16px;font-size:32px;letter-spacing:0.35em;font-weight:700;color:#2c2c33;">${code}</p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#5c5c66;">It expires in 10 minutes and works once. If you didn't try to sign in, you can ignore this email.</p>`;
}

export function scrubEmailMfaSecret(message: string, code: string): string {
  const cleaned = message.split(code).join("").replace(/\s+/g, " ").trim();
  return cleaned || "Couldn't send the verification email.";
}

export function emailMfaConsumeMessage(status: string): string {
  switch (status) {
    case "mismatch":
      return "That code doesn't match. Try again.";
    case "expired":
      return "That code expired. Send a new one.";
    case "locked":
      return "Too many tries. Send a new code.";
    case "missing":
      return "Send a code first.";
    case "used":
      return "That code was already used. Send a new one.";
    default:
      return "That code didn't work. Send a new one.";
  }
}

export function emailMfaBeginMessage(status: string): string {
  switch (status) {
    case "resend":
      return "We just sent a code. Wait a minute before asking for another.";
    case "limited":
      return "Too many codes were sent. Wait an hour and try again.";
    default:
      return "Couldn't send a verification code. Try again.";
  }
}

export function isMissingEmailMfaSchema(message: string): boolean {
  return /staff_email_mfa|xos_email_mfa|schema cache|does not exist/i.test(message);
}
