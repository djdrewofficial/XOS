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

/** App redirect the couple-app reset email requests. Go's HTML template will
    not put this scheme in an href, so the message uses the HTTPS bridge. */
export const MOBILE_RESET_REDIRECT = "xpressclient://auth/reset";
export const MOBILE_RESET_BRIDGE = "https://xos.xpressdjs.com/auth/reset";

export type MobileResetView =
  | { state: "ready"; href: string }
  | { state: "missing" }
  | { state: "invalid" }
  | { state: "expired" };

export function mobileResetResponseHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

function queryValues(query: URLSearchParams, key: string): string[] {
  return query.getAll(key).filter((value) => value !== "");
}

/** Button target for the installed app. It accepts token_hash on this exact
    URL and does not adopt an access-token fragment. */
function mobileResetButton(token: string): string | null {
  const dest = new URL(MOBILE_RESET_REDIRECT);
  dest.searchParams.set("token_hash", token);
  dest.searchParams.set("type", "recovery");
  dest.hash = "";
  if (dest.protocol !== "xpressclient:") return null;
  if (dest.hostname !== "auth" || dest.pathname !== "/reset") return null;
  if (dest.username || dest.password) return null;
  const keys = [...dest.searchParams.keys()];
  if (keys.length !== 2 || keys[0] !== "token_hash" || keys[1] !== "type") return null;
  if (dest.searchParams.get("token_hash") !== token || dest.searchParams.get("type") !== "recovery") return null;
  if (!dest.href.startsWith(`${MOBILE_RESET_REDIRECT}?`)) return null;
  if (dest.href.includes("#") || dest.href.includes("@") || dest.href.includes("\\")) return null;
  return dest.href;
}

export function mobileResetView(query: URLSearchParams): MobileResetView {
  if (
    queryValues(query, "error").length ||
    queryValues(query, "error_code").length ||
    queryValues(query, "error_description").length
  ) {
    return { state: "expired" };
  }
  const types = queryValues(query, "type");
  const hashes = queryValues(query, "token_hash");
  if (types.length === 0 || hashes.length === 0) return { state: "missing" };
  if (types.length !== 1 || hashes.length !== 1 || types[0] !== "recovery") return { state: "invalid" };
  const token = safeRecoveryToken(hashes[0]);
  if (!token) return { state: "invalid" };
  const href = mobileResetButton(token);
  if (!href) return { state: "invalid" };
  return { state: "ready", href };
}
