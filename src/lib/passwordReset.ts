import { appUrl } from "@/lib/signing";

/* Where a Supabase password-reset email sends the person. Must be on the
   project's Auth redirect allowlist. The page accepts both a PKCE `code`
   (default email template, same browser) and `token_hash` (custom template,
   any device). */
export const PASSWORD_RESET_PATH = "/auth/set-password";

const PRODUCTION_HOST = "xos.xpressdjs.com";

function configuredHost(): string | null {
  try {
    return new URL(appUrl()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname === PRODUCTION_HOST) return true;
  if (hostname.endsWith(".netlify.app")) return true;
  const configured = configuredHost();
  return Boolean(configured && hostname === configured);
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
