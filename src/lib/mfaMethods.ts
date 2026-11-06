/** A second factor the sign-in screen can offer. */
export type MfaMethod = "totp" | "phone" | "email";

const E164 = /^\+[1-9]\d{7,14}$/;

export function sixDigitCode(code: string | null | undefined): boolean {
  return /^\d{6}$/.test((code ?? "").trim());
}

/** Login phone wins. The staff profile number is the fallback.
    `normalize` is XOS `toE164`, passed in so this file stays free of server imports. */
export function preferredMfaPhone(
  authPhone: string | null | undefined,
  profilePhone: string | null | undefined,
  normalize: (raw: string) => string | null,
): { e164: string; source: "login" | "profile" } | null {
  const login = accept(authPhone, normalize);
  if (login) return { e164: login, source: "login" };
  const profile = accept(profilePhone, normalize);
  if (profile) return { e164: profile, source: "profile" };
  return null;
}

function accept(raw: string | null | undefined, normalize: (raw: string) => string | null): string | null {
  if (!raw?.trim()) return null;
  const e164 = normalize(raw);
  if (!e164 || !E164.test(e164)) return null;
  return e164;
}

/** Last four digits, for a challenge screen. */
export function maskPhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "your phone";
  return `••• ••• ${digits.slice(-4)}`;
}

/** First character plus the domain, so a challenge screen isn't a full address. */
export function maskEmail(raw: string | null | undefined): string {
  const email = (raw ?? "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "your email";
  return `${email.slice(0, 1)}•••@${email.slice(at + 1)}`;
}

/** Authenticator first, then text, then email. Null when nothing is enrolled. */
export function pickMfaMethod(available: { totp: boolean; phone: boolean; email: boolean }): MfaMethod | null {
  if (available.totp) return "totp";
  if (available.phone) return "phone";
  if (available.email) return "email";
  return null;
}

/** GoTrue's phone-MFA switch is off until it's enabled in the Auth dashboard. */
export function friendlySupabaseMfaError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("mfa enroll is disabled") || (text.includes("phone") && text.includes("enroll") && text.includes("disabled"))) {
    return "Text-message verification isn't turned on for XOS yet. An admin needs to enable the Phone factor under Supabase Authentication → Multi-Factor.";
  }
  if (text.includes("mfa verification is disabled") || (text.includes("verify") && text.includes("disabled") && text.includes("phone"))) {
    return "Text-message verification isn't turned on for XOS yet. An admin needs to enable the Phone factor under Supabase Authentication → Multi-Factor.";
  }
  return message;
}
