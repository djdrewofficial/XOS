/* Client-side mirror of the Supabase Auth password policy
   (Dashboard → Authentication → Policies): a minimum length plus the required
   character classes — lowercase, uppercase, digit, and symbol.

   GoTrue is the real enforcer (it also rejects breached passwords via
   HaveIBeenPwned); this just drives the live requirement checklist so a user
   fixing their password gets instant feedback instead of a raw server error.
   Keep these in sync with the dashboard settings. The symbol set matches
   GoTrue's default "symbols" group. */

export const PASSWORD_MIN_LENGTH = 8;

// GoTrue's default symbol group (the preset enabled in the dashboard).
export const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./";

export type PasswordRule = {
  key: string;
  label: string;
  test: (pw: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  { key: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { key: "lower", label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { key: "upper", label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { key: "digit", label: "A number", test: (p) => /[0-9]/.test(p) },
  { key: "symbol", label: "A symbol (e.g. ! @ # $ %)", test: (p) => [...p].some((c) => PASSWORD_SYMBOLS.includes(c)) },
];

/** The rules a password fails (empty array = fully compliant). */
export function failedPasswordRules(pw: string): PasswordRule[] {
  return PASSWORD_RULES.filter((r) => !r.test(pw));
}

/** True when the password satisfies every policy rule. */
export function passwordMeetsPolicy(pw: string): boolean {
  return failedPasswordRules(pw).length === 0;
}

const MAX_PASSWORD_LENGTH = 256;

/** The checks both the account form and the server action share before calling Supabase. */
export function validatePasswordChange(input: {
  current: string;
  next: string;
  confirm: string;
}): { ok: true } | { ok: false; error: string } {
  const current = input.current ?? "";
  const next = input.next ?? "";
  const confirm = input.confirm ?? "";
  if (!current) return { ok: false, error: "Enter your current password." };
  if (current.length > MAX_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: "That password is too long." };
  }
  if (!passwordMeetsPolicy(next)) {
    return { ok: false, error: "Your password doesn't meet all the requirements." };
  }
  if (next !== confirm) return { ok: false, error: "Passwords don't match." };
  if (next === current) {
    return { ok: false, error: "Choose a password that's different from your current one." };
  }
  return { ok: true };
}
