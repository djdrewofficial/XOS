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

export function assertLiveRecoveryLink(link: string, kind: OneTimeKind): void {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("The one-time link is not a URL.");
  }
  if (url.username || url.password) throw new Error("The one-time link cannot carry credentials.");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The one-time link must be an http(s) URL.");
  const token = url.searchParams.get("token") ?? "";
  if (token.length < 8) throw new Error("The one-time link is missing its token.");
  const type = url.searchParams.get("type");
  if (type && type !== "recovery") throw new Error("The one-time link must be a recovery action.");
  const redirect = url.searchParams.get("redirect_to");
  if (!redirect) throw new Error("The one-time link must name its redirect.");
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirect);
  } catch {
    throw new Error("The one-time link redirect is not a URL.");
  }
  const expected = kind === "set-password" ? "/auth/set-password" : "/auth/set-password";
  if (redirectUrl.pathname !== expected) throw new Error(`The one-time link must redirect to ${expected}.`);
}

/** Returns the body that will be sent. Throws when anything other than the token differs. */
export function applyOneTimeLink(frozenBody: string, liveLink: string, kind: OneTimeKind): string {
  const placeholder = ONE_TIME_PLACEHOLDER[kind];
  const parts = frozenBody.split(placeholder);
  if (parts.length !== 2) throw new Error("The approval must contain the one-time link placeholder exactly once.");
  assertLiveRecoveryLink(liveLink, kind);
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
