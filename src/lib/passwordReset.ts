import { appUrl } from "@/lib/signing";
import { PASSWORD_RESET_PATH, passwordResetHostAllowed } from "./passwordResetPath";

/* Staff forgot-password redirect. The shared Auth template appends
   ?token_hash={{ .TokenHash }}&type=recovery to this URL. Staff stays on
   /auth/set-password. */
export { PASSWORD_RESET_PATH, safeRecoveryToken } from "./passwordResetPath";

function configuredHost(): string | null {
  try {
    return new URL(appUrl()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedHost(hostname: string): boolean {
  return passwordResetHostAllowed(hostname, configuredHost());
}

/** Absolute redirect for resetPasswordForEmail. Prefers the request host when
    it is one of ours (local dev, production, Netlify previews) so the link
    returns to the site that asked; otherwise falls back to NEXT_PUBLIC_APP_URL. */
export function passwordResetRedirect(h: Headers): string {
  const fallbackBase = appUrl().replace(/\/$/, "");
  const fallback = `${fallbackBase}${PASSWORD_RESET_PATH}`;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]?.trim() ?? "";
  if (!host || /[\s/\\]/.test(host)) return fallback;
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (!isAllowedHost(hostname)) return fallback;
  const proto = hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https";
  try {
    return `${new URL(`${proto}://${host}`).origin}${PASSWORD_RESET_PATH}`;
  } catch {
    return fallback;
  }
}
