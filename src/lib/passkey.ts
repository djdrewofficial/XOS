/** Passkey rules that do not touch the database or the WebAuthn library.
    The server calls these before it will open a Supabase session. */

export const PASSKEY_RP_NAME = "XOS";
export const PASSKEY_PRODUCTION_ORIGIN = "https://xos.xpressdjs.com";
export const PASSKEY_PRODUCTION_RP_ID = "xos.xpressdjs.com";
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_MAX_PER_USER = 10;
export const PASSKEY_UV = "required" as const;
export const PASSKEY_AUTHENTICATOR_SELECTION = {
  residentKey: "required" as const,
  userVerification: "required" as const,
};

export const LAST_METHOD_MESSAGE =
  "Add a passkey or another verification code first. This account has to keep at least one.";

const CHALLENGE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRANSPORTS = new Set(["usb", "nfc", "ble", "internal", "hybrid", "smart-card"]);

export type PasskeyEnv = {
  /** Netlify sets NETLIFY=true. Local `npm run dev` does not. */
  netlify: boolean;
  /** production, deploy-preview, branch-deploy, or dev. */
  context: string | null;
  deployPrimeUrl: string | null;
  /** Netlify site subdomain. Previews are only accepted for this site. */
  siteName: string | null;
};

export type PasskeyBinding = { rpId: string; origin: string };

export type CounterDecision = "ok" | "clone" | "invalid";

export type AuthMethodCounts = {
  passkeys: number;
  totp: number;
  phone: number;
  email: number;
  otherFactors: number;
};

export type CeremonyKind = "register" | "authenticate";

export type PasskeySummary = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
  deviceType: "singleDevice" | "multiDevice";
};

export function passkeyEnvFrom(env: Record<string, string | undefined>): PasskeyEnv {
  const site = env.SITE_NAME?.trim().toLowerCase() ?? "";
  return {
    netlify: env.NETLIFY === "true",
    context: env.CONTEXT?.trim() || null,
    deployPrimeUrl: env.DEPLOY_PRIME_URL?.trim() || null,
    siteName: SITE_NAME_RE.test(site) ? site : null,
  };
}

/** Where this request is allowed to run a passkey ceremony.
    Production is xos.xpressdjs.com. Local dev is http://localhost (any port)
    and is refused on Netlify. A deploy preview accepts only the hostname
    Netlify assigned that deploy, and only when it belongs to this site.
    The RP ID is that exact host, never a parent like netlify.app. */
export function passkeyBindingForOrigin(origin: string | null | undefined, env: PasskeyEnv): PasskeyBinding | null {
  const parsed = canonicalOrigin(origin);
  if (!parsed) return null;
  const preview = env.context === "deploy-preview" || env.context === "branch-deploy";

  if (!env.netlify && parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
    return { rpId: parsed.hostname, origin: parsed.origin };
  }
  if (parsed.protocol !== "https:") return null;

  if (preview) {
    const prime = canonicalOrigin(env.deployPrimeUrl);
    if (!prime || prime.origin !== parsed.origin) return null;
    if (!previewHostname(parsed.hostname, env.siteName)) return null;
    return { rpId: parsed.hostname, origin: parsed.origin };
  }

  if (parsed.origin === PASSKEY_PRODUCTION_ORIGIN) {
    return { rpId: PASSKEY_PRODUCTION_RP_ID, origin: parsed.origin };
  }

  if (
    env.netlify &&
    env.context === "production" &&
    env.siteName &&
    parsed.hostname === `${env.siteName}.netlify.app`
  ) {
    return { rpId: parsed.hostname, origin: parsed.origin };
  }

  return null;
}

export function originFromHeaders(headers: { get(name: string): string | null }): string | null {
  const origin = headers.get("origin")?.trim();
  if (origin) return origin;
  const referer = headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function canonicalOrigin(value: string | null | undefined): { origin: string; protocol: string; hostname: string } | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return { origin: url.origin, protocol: url.protocol, hostname: url.hostname.toLowerCase() };
}

function previewHostname(hostname: string, siteName: string | null): boolean {
  if (!siteName) return false;
  const suffix = `--${siteName}.netlify.app`;
  if (!hostname.endsWith(suffix)) return false;
  const label = hostname.slice(0, -suffix.length);
  if (label.length < 1 || label.length > 63) return false;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) return false;
  return true;
}

/** Synced passkeys stay at 0. A counter that has ever moved must keep moving up. */
export function counterDecision(stored: number, next: number): CounterDecision {
  if (!Number.isSafeInteger(stored) || !Number.isSafeInteger(next) || stored < 0 || next < 0) return "invalid";
  if (stored === 0 && next === 0) return "ok";
  if (next > stored) return "ok";
  return "clone";
}

export type AssertionCheck = {
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  requireUserVerification: true;
  credential: { id: string; publicKey: Uint8Array; counter: number };
};

/** Arguments for verifyAuthenticationResponse. User verification is required. */
export function webAuthnAuthenticationCheck(input: {
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
}): AssertionCheck {
  return {
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.expectedOrigin,
    expectedRPID: input.expectedRPID,
    requireUserVerification: true,
    credential: {
      id: input.credentialId,
      publicKey: input.publicKey,
      counter: input.counter,
    },
  };
}

export type RegistrationCheck = {
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  requireUserVerification: true;
};

export function webAuthnRegistrationCheck(input: {
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
}): RegistrationCheck {
  return {
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.expectedOrigin,
    expectedRPID: input.expectedRPID,
    requireUserVerification: true,
  };
}

export type OutcomeReason =
  | "unverified"
  | "user_verification"
  | "origin"
  | "rp"
  | "challenge"
  | "credential"
  | "counter"
  | "staff"
  | "handle"
  | "duplicate";

export type AuthOutcome =
  | { ok: true; nextCounter: number }
  | { ok: false; reason: OutcomeReason };

/** Every flag has to be true before a Supabase session may be opened. */
export function decideAuthenticationOutcome(input: {
  verified: boolean;
  userVerified: boolean;
  originAllowed: boolean;
  rpIdMatches: boolean;
  challengeOk: boolean;
  credentialFound: boolean;
  counter: CounterDecision;
  staffUser: boolean;
  userHandleOk: boolean;
  nextCounter: number;
}): AuthOutcome {
  if (!input.challengeOk) return { ok: false, reason: "challenge" };
  if (!input.credentialFound) return { ok: false, reason: "credential" };
  if (!input.originAllowed) return { ok: false, reason: "origin" };
  if (!input.rpIdMatches) return { ok: false, reason: "rp" };
  if (!input.userHandleOk) return { ok: false, reason: "handle" };
  if (!input.verified) return { ok: false, reason: "unverified" };
  if (!input.userVerified) return { ok: false, reason: "user_verification" };
  if (input.counter !== "ok") return { ok: false, reason: "counter" };
  if (!input.staffUser) return { ok: false, reason: "staff" };
  if (!Number.isSafeInteger(input.nextCounter) || input.nextCounter < 0) return { ok: false, reason: "counter" };
  return { ok: true, nextCounter: input.nextCounter };
}

export function decideRegistrationOutcome(input: {
  verified: boolean;
  userVerified: boolean;
  originAllowed: boolean;
  rpIdMatches: boolean;
  challengeOk: boolean;
  staffUser: boolean;
}): { ok: true } | { ok: false; reason: OutcomeReason } {
  if (!input.challengeOk) return { ok: false, reason: "challenge" };
  if (!input.originAllowed) return { ok: false, reason: "origin" };
  if (!input.rpIdMatches) return { ok: false, reason: "rp" };
  if (!input.verified) return { ok: false, reason: "unverified" };
  if (!input.userVerified) return { ok: false, reason: "user_verification" };
  if (!input.staffUser) return { ok: false, reason: "staff" };
  return { ok: true };
}

/** A password session may add the first method. Adding another passkey waits
    until this session has already finished a passkey or a second factor, so a
    stolen password cannot enroll a new passkey and skip the existing one. */
export function registrationAllowed(input: { sessionSatisfied: boolean; methodCount: number }): boolean {
  if (!Number.isSafeInteger(input.methodCount) || input.methodCount < 0) return false;
  if (input.methodCount === 0) return true;
  return input.sessionSatisfied;
}

export function methodCount(methods: AuthMethodCounts): number {
  return methods.passkeys + methods.totp + methods.phone + methods.email + methods.otherFactors;
}

export function hasStrongAuth(methods: AuthMethodCounts): boolean {
  return methodCount(methods) > 0;
}

export function removalWouldLeaveNone(methods: AuthMethodCounts, removing: keyof AuthMethodCounts): boolean {
  const left = methodCount(methods) - 1;
  if (methods[removing] <= 0) return true;
  return left <= 0;
}

export function factorBucket(type: string): "totp" | "phone" | "otherFactors" {
  if (type === "totp") return "totp";
  if (type === "phone") return "phone";
  return "otherFactors";
}

export function isPasskeyChallenge(value: string): boolean {
  return CHALLENGE_RE.test(value);
}

export function uuidToBytes(id: string): Uint8Array | null {
  if (!UUID_RE.test(id)) return null;
  const hex = id.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
    const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** userHandle is optional. When the authenticator sends one, it has to be the
    id we stored at registration — never a user id the browser typed. */
export function userHandleMatches(userHandle: string | undefined, userId: string): boolean {
  if (!userHandle) return true;
  const expected = uuidToBytes(userId);
  if (!expected) return false;
  return userHandle === bytesToBase64Url(expected);
}

export function clientDataFields(clientDataJSON: string): { type: string; challenge: string; origin: string } | null {
  const bytes = base64UrlToBytes(clientDataJSON);
  if (!bytes || bytes.length > 4096) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (typeof json.type !== "string" || typeof json.challenge !== "string" || typeof json.origin !== "string") return null;
    if (!isPasskeyChallenge(json.challenge)) return null;
    return { type: json.type, challenge: json.challenge, origin: json.origin };
  } catch {
    return null;
  }
}

export function cleanTransports(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const out: string[] = [];
  for (const value of values) {
    if (TRANSPORTS.has(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

export function cleanPasskeyName(value: unknown, fallback: string): string {
  const base = fallback.trim().slice(0, 80) || "Passkey";
  if (typeof value !== "string") return base;
  const trimmed = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return base;
  return trimmed.slice(0, 80);
}

export function defaultPasskeyName(userAgent: string | null, backedUp: boolean): string {
  const ua = userAgent ?? "";
  let base = "Passkey";
  if (/iPhone|iPad/.test(ua)) base = "iPhone or iPad";
  else if (/Macintosh|Mac OS/.test(ua)) base = "Mac";
  else if (/Android/.test(ua)) base = "Android";
  else if (/Windows/.test(ua)) base = "Windows";
  else if (/Linux/.test(ua)) base = "Linux";
  return backedUp ? `${base} passkey` : base;
}

export function classifyWebAuthnError(error: unknown): OutcomeReason {
  const message = error instanceof Error ? error.message : "";
  const lower = message.toLowerCase();
  if (lower.includes("counter")) return "counter";
  if (lower.includes("user verification") || lower.includes("user could not be verified")) return "user_verification";
  if (lower.includes("origin")) return "origin";
  if (lower.includes("rp id") || lower.includes("rpid")) return "rp";
  if (lower.includes("challenge")) return "challenge";
  return "unverified";
}

export function passkeyFailureMessage(reason: string): string {
  switch (reason) {
    case "challenge":
    case "expired":
    case "used":
    case "missing":
    case "kind":
    case "owner":
      return "That passkey check expired. Try again.";
    case "counter":
    case "clone":
      return "This passkey was already used in a way that doesn't look right. Remove it and add it again, or use a verification code.";
    case "origin":
    case "rp":
    case "bad_origin":
      return "Passkeys can't be used from this address.";
    case "user_verification":
      return "Confirm it's you with Face ID, Touch ID, your device PIN, or your password manager.";
    case "limited":
      return "Too many passkey attempts. Wait a bit and try again.";
    case "last":
    case "last_method":
      return LAST_METHOD_MESSAGE;
    case "setup":
      return "Passkeys need a one-time database setup before they can be used.";
    case "staff":
    case "credential":
      return "That passkey isn't saved on an XOS staff account.";
    case "full":
      return "This account already has 10 passkeys. Remove one before adding another.";
    case "forbidden":
      return "Finish signing in with your passkey or a verification code before adding another.";
    default:
      return "That passkey didn't work. Try again.";
  }
}

export function passkeyCeremonyMessage(input: { name?: string; code?: string }): string | null {
  if (input.code === "ERROR_CEREMONY_ABORTED" || input.name === "AbortError") return null;
  if (input.name === "NotAllowedError") return "The passkey prompt was closed.";
  if (input.name === "InvalidStateError" || input.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "That passkey is already saved on this account.";
  }
  if (input.code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT") {
    return "This device can't confirm it's you with a passkey.";
  }
  return "The passkey couldn't be used. Try again.";
}

export function isMissingPasskeySchema(message: string): boolean {
  return /staff_passkeys|staff_passkey_challenges|xos_passkey_|xos_has_sign_in_method|xos_keep_last_/i.test(message)
    && /does not exist|schema cache|could not find/i.test(message);
}

export function isLastMethodError(message: string): boolean {
  return /last_method/i.test(message);
}

export function isAuthenticationResponse(value: unknown): value is {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
} {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const response = body.response;
  if (!response || typeof response !== "object") return false;
  const inner = response as Record<string, unknown>;
  return (
    typeof body.id === "string" &&
    body.id.length >= 16 &&
    body.id.length <= 512 &&
    body.rawId === body.id &&
    body.type === "public-key" &&
    typeof inner.clientDataJSON === "string" &&
    typeof inner.authenticatorData === "string" &&
    typeof inner.signature === "string" &&
    (inner.userHandle === undefined || typeof inner.userHandle === "string")
  );
}

export function isRegistrationResponse(value: unknown): value is {
  id: string;
  rawId: string;
  type: "public-key";
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
} {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const response = body.response;
  if (!response || typeof response !== "object") return false;
  const inner = response as Record<string, unknown>;
  return (
    typeof body.id === "string" &&
    body.id.length >= 16 &&
    body.id.length <= 512 &&
    body.rawId === body.id &&
    body.type === "public-key" &&
    typeof inner.clientDataJSON === "string" &&
    typeof inner.attestationObject === "string"
  );
}
