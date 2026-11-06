/** Staff browser sign-in helpers. Social sign-in never creates a staff row
    and never counts as the passkey or second-factor proof. */

export type StaffSsoProvider = "google" | "apple";

export function staffSsoProvider(value: string | null | undefined): StaffSsoProvider | null {
  if (value === "google" || value === "apple") return value;
  return null;
}

/** Only an already-linked staff login, an employee row, or the owner break-glass
    email may enter XOS after Google or Apple. A client, guest, or brand-new
    social login is refused. Nothing here inserts an accounts row. */
export function staffIdentityAllowed(input: {
  accountType: string | null;
  employeeLinked: boolean;
  ownerEmail: boolean;
}): boolean {
  if (input.accountType === "client" || input.accountType === "event_guest") return false;
  return input.accountType === "staff" || input.employeeLinked || input.ownerEmail;
}

/** After password or social sign-in, XOS still requires a passkey or a second
    factor when one is enrolled, or enrollment when the role requires it.
    The social callback must not set the passkey step-up cookie. */
export function ssoNeedsStaffGate(input: {
  currentLevel: string | null | undefined;
  nextLevel: string | null | undefined;
  emailMfa: boolean;
  passkeyMfa: boolean;
}): boolean {
  if (input.currentLevel === "aal2") return false;
  if (input.nextLevel === "aal2") return true;
  return input.emailMfa || input.passkeyMfa;
}

/** Staff return paths stay on this site. /sso/ is the only off-ramp, and it
    is still a local path the server redirects. */
export function safeStaffNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/sso/")) return null;
  if (raw.startsWith("//") || raw.includes("\\") || raw.includes("://")) return null;
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;
  if (raw.length > 200) return null;
  return raw;
}

export function staffCallbackUrl(origin: string, next: string | null): string | null {
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (base.username || base.password) return null;
  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") return null;
  const url = new URL("/auth/callback", base.origin);
  const safe = safeStaffNext(next);
  if (safe) url.searchParams.set("next", safe);
  return url.toString();
}
