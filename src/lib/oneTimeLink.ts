/** Invite and reset approval.
    The frozen body contains a typed placeholder. At send time the only change
    allowed is replacing that placeholder with the recovery link. The token
    inside the link is the dynamic part. The host, the redirect path, and the
    action type are the invariant. The raw token is not returned to the agent. */

export const ONE_TIME_PLACEHOLDER = {
  "set-password": "[one-time-link:set-password]",
  recovery: "[one-time-link:recovery]",
} as const;

export type OneTimeKind = keyof typeof ONE_TIME_PLACEHOLDER;

export const RESET_APPROVAL_BODY = `<p>Password reset</p><p>We received a request to reset your XOS password.</p><a href="${ONE_TIME_PLACEHOLDER["set-password"]}">Reset My Password</a><p>This link expires in 24 hours.</p>`;

export type RecoveryOrigins = { appOrigin: string; authOrigin: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function originOf(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a URL.`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`${label} must be https, or http on localhost.`);
  }
  return url;
}

export function assertLiveRecoveryLink(link: string, kind: OneTimeKind, origins?: RecoveryOrigins): void {
  void kind;
  const app = originOf(origins?.appOrigin ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://xos.xpressdjs.com", "App origin");
  const auth = originOf(origins?.authOrigin ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qjnzicqvzmvwryisjvip.supabase.co", "Auth origin");
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("The one-time link is not a URL.");
  }
  if (url.username || url.password) throw new Error("The one-time link cannot carry credentials.");
  if (url.protocol !== auth.protocol || url.host !== auth.host) throw new Error("The one-time link must come from the configured auth host.");
  if (url.pathname !== "/auth/v1/verify") throw new Error("The one-time link must use the auth verify path.");
  if (url.searchParams.get("type") !== "recovery") throw new Error("The one-time link must be a recovery action.");
  const token = url.searchParams.get("token") ?? "";
  if (token.length < 8) throw new Error("The one-time link is missing its token.");
  const redirect = url.searchParams.get("redirect_to");
  if (!redirect) throw new Error("The one-time link must name its redirect.");
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirect);
  } catch {
    throw new Error("The one-time link redirect is not a URL.");
  }
  if (redirectUrl.protocol !== app.protocol || redirectUrl.host !== app.host) throw new Error("The one-time link must redirect to the configured app host.");
  if (redirectUrl.pathname !== "/auth/set-password") throw new Error("The one-time link must redirect to /auth/set-password.");
}

/** Returns the body that will be sent. Throws when anything other than the token differs. */
export function applyOneTimeLink(frozenBody: string, liveLink: string, kind: OneTimeKind, origins?: RecoveryOrigins): string {
  const placeholder = ONE_TIME_PLACEHOLDER[kind];
  const parts = frozenBody.split(placeholder);
  if (parts.length !== 2) throw new Error("The approval must contain the one-time link placeholder exactly once.");
  assertLiveRecoveryLink(liveLink, kind, origins);
  const sent = `${parts[0]}${liveLink}${parts[1]}`;
  if (sent.includes(placeholder)) throw new Error("The one-time link was not substituted.");
  if (sent.includes(new URL(liveLink).searchParams.get("token") ?? "\0") === false) {
    throw new Error("The one-time link was not substituted.");
  }
  const again = sent.split(liveLink);
  if (again.length !== 2 || `${again[0]}${placeholder}${again[1]}` !== frozenBody) {
    throw new Error("The sent body does not match the approval.");
  }
  return sent;
}
