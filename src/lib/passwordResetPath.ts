/* Password-reset URL rules with no app-URL import, so tests can load them. */

export const PASSWORD_RESET_PATH = "/auth/set-password";

const PRODUCTION_HOST = "xos.xpressdjs.com";

export function passwordResetHostAllowed(hostname: string, configuredHost: string | null): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === PRODUCTION_HOST) return true;
  if (host.endsWith(".netlify.app")) return true;
  return Boolean(configuredHost && host === configuredHost.toLowerCase());
}

/** Keep a recovery token that can sit in a query string. Reject anything that
    could change the path, add another parameter, or break the line. */
export function safeRecoveryToken(value: string | null | undefined): string | null {
  const token = (value ?? "").trim();
  if (!token || token.length > 2000) return null;
  if (/[\s/?#\\&=%]/.test(token)) return null;
  return token;
}

/** Supabase sends a rejected app redirect to the Site URL root, with the
    token on the query. Rewrite only that exact case, on the same host, and
    carry only token_hash and type. Any other root visit stays put. */
export function sameHostRecoveryRedirect(current: URL): URL | null {
  if (current.pathname !== "/") return null;
  if (current.searchParams.get("type") !== "recovery") return null;
  const token = safeRecoveryToken(current.searchParams.get("token_hash"));
  if (!token) return null;
  const dest = new URL(PASSWORD_RESET_PATH, current.origin);
  dest.searchParams.set("token_hash", token);
  dest.searchParams.set("type", "recovery");
  if (dest.origin !== current.origin || dest.pathname !== PASSWORD_RESET_PATH) return null;
  if (dest.searchParams.get("token_hash") !== token || dest.searchParams.get("type") !== "recovery") return null;
  return dest;
}
