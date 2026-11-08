/* Password-reset URL rules with no app-URL import, so tests can load them. */

export const PASSWORD_RESET_PATH = "/auth/set-password";
export const RECOVERY_CONFIRM_PATH = "/auth/confirm";

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
  if (/[\s/?#\\&=]/.test(token)) return null;
  return token;
}

/** Where /auth/confirm sends the browser. Only a recovery token_hash is
    forwarded, and only to this site's set-password page. Every other
    parameter, including next and redirect_to, is dropped. */
export function recoveryConfirmPath(params: URLSearchParams): string {
  const token = params.get("type") === "recovery" ? safeRecoveryToken(params.get("token_hash")) : null;
  if (!token) return PASSWORD_RESET_PATH;
  const dest = new URLSearchParams();
  dest.set("token_hash", token);
  dest.set("type", "recovery");
  return `${PASSWORD_RESET_PATH}?${dest.toString()}`;
}
