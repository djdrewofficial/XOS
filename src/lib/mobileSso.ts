/* "Sign in with XOS" for the XOS Staff iPhone app.

   The app opens /sso/mobile in an ASWebAuthenticationSession with a PKCE
   code_challenge (S256) and its own return URL. The person signs in on the web
   the normal way (passkey, Google, Apple, or password + code), the route checks
   the same 2FA decision the gallery hand-off uses, and redirects back to the app
   with a short-lived signed code. The app then POSTs the code and its
   code_verifier to /api/mobile/sso/exchange for a fresh Supabase session.

   The code never carries a token. It is useless without the verifier, which
   never leaves the app, so a different app claiming the URL scheme gets
   nothing. It also lives two minutes and the exchange burns it after one use.

   No server-only imports here so the tests can load it. */

export const MOBILE_SSO_CODE_TTL_SEC = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** RFC 7636: BASE64URL(SHA256(verifier)) is exactly 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636: 43–128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const STATE = /^[A-Za-z0-9_-]{16,128}$/;

export function validCodeChallenge(value: string | null | undefined): value is string {
  return CHALLENGE.test(value ?? "");
}

export function validCodeVerifier(value: string | null | undefined): value is string {
  return VERIFIER.test(value ?? "");
}

export function validState(value: string | null | undefined): value is string {
  return STATE.test(value ?? "");
}

/** Hosts Expo Go may use: this machine or a private LAN address (the dev
    box running Metro). Extra hosts (e.g. an Expo tunnel) only by env. */
function expoHostAllowed(host: string, extra: readonly string[]): boolean {
  const h = host.toLowerCase();
  if (extra.includes(h)) return true;
  if (h === "localhost" || h === "127.0.0.1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((p) => Number(p) > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Where the app may ask to be sent back to. The installed app uses its own
    scheme; Expo Go (development) uses exp://<dev host>/--/auth/sso, limited to
    private/LAN hosts plus `extraExpoHosts` (MOBILE_SSO_EXPO_HOSTS). Nothing
    else: no https, no credentials, no extra query or fragment. */
export function safeMobileReturnUrl(raw: string | null | undefined, extraExpoHosts: readonly string[] = []): string | null {
  if (!raw || raw.length > 300) return null;
  if (/[\s\\\u0000-\u001F\u007F]/.test(raw)) return null;
  if (raw === "xosmobile://auth/sso") return raw;
  const m = /^exp:\/\/([A-Za-z0-9.-]+)(:\d{2,5})?\/--\/auth\/sso$/.exec(raw);
  if (!m) return null;
  return expoHostAllowed(m[1], extraExpoHosts) ? raw : null;
}

export function expoHostsFromEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9.-]{1,253}$/.test(h));
}

function bytesToB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`mobile-sso:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** BASE64URL(SHA256(verifier)) — the S256 method. */
export async function pkceChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToB64url(new Uint8Array(digest));
}

export type MobileSsoCode = {
  v: 1;
  /** auth user id */
  uid: string;
  /** PKCE S256 challenge the app sent */
  ch: string;
  /** random id, burned on exchange */
  jti: string;
  /** unix seconds */
  exp: number;
};

export async function signMobileSsoCode(
  input: { uid: string; ch: string; jti: string; exp: number },
  secret: string,
): Promise<string> {
  if (!UUID.test(input.uid) || !CHALLENGE.test(input.ch) || !UUID.test(input.jti) || !Number.isFinite(input.exp)) {
    throw new Error("bad sso code");
  }
  if (!secret || secret.length < 16) throw new Error("secret");
  const body: MobileSsoCode = { v: 1, uid: input.uid, ch: input.ch, jti: input.jti, exp: input.exp };
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${bytesToB64url(new Uint8Array(sig))}`;
}

/** The code's claims when the signature is good, it hasn't expired, and the
    verifier hashes to its challenge. Null otherwise. */
export async function readMobileSsoCode(
  code: string | null | undefined,
  verifier: string | null | undefined,
  secret: string | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<MobileSsoCode | null> {
  if (!code || code.length > 1000 || !secret || secret.length < 16 || !validCodeVerifier(verifier)) return null;
  const dot = code.indexOf(".");
  if (dot <= 0 || dot !== code.lastIndexOf(".")) return null;
  const payload = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlToBytes(sig) as BufferSource, new TextEncoder().encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  let body: Partial<MobileSsoCode>;
  try {
    body = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as Partial<MobileSsoCode>;
  } catch {
    return null;
  }
  if (body.v !== 1 || !UUID.test(body.uid ?? "") || !UUID.test(body.jti ?? "") || !CHALLENGE.test(body.ch ?? "")) return null;
  if (typeof body.exp !== "number" || body.exp <= nowSec || body.exp > nowSec + MOBILE_SSO_CODE_TTL_SEC + 5) return null;
  if ((await pkceChallengeFor(verifier)) !== body.ch) return null;
  return body as MobileSsoCode;
}

/** Return URL with only code + state on it. */
export function mobileReturnWith(returnUrl: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${returnUrl}?${qs}`;
}
