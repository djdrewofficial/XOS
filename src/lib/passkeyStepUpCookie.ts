/** HttpOnly proof that this staff session finished a passkey ceremony.
    A passkey sign-in is fully verified on its own, including when the account
    also has an authenticator or a text code. The cookie is bound to the
    Supabase session that was opened after the ceremony, and it uses the same
    server secret as the email second factor. */

export const MFA_PASSKEY_COOKIE = "xos_mfa_passkey";
export const MFA_PASSKEY_STEPUP_TTL_SEC = 12 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StepUpPayload = {
  v: 1;
  method: "passkey";
  uid: string;
  sid: string;
  exp: number;
};

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
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signMfaPasskeyStepUp(
  input: { uid: string; sid: string; exp: number },
  secret: string,
): Promise<string> {
  if (!UUID.test(input.uid) || !UUID.test(input.sid) || !Number.isFinite(input.exp)) {
    throw new Error("bad step-up");
  }
  const payload = bytesToB64url(
    new TextEncoder().encode(
      JSON.stringify({ v: 1, method: "passkey", uid: input.uid, sid: input.sid, exp: input.exp }),
    ),
  );
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${bytesToB64url(new Uint8Array(sig))}`;
}

/** True only when the cookie is signed, unexpired, and bound to this user and session. */
export async function readMfaPasskeyStepUp(
  token: string | undefined,
  secret: string | undefined,
  userId: string,
  sessionId: string | null,
): Promise<boolean> {
  if (!token || !secret || secret.length < 16 || !sessionId || !UUID.test(userId)) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return false;
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      b64urlToBytes(sig) as BufferSource,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
  if (!ok) return false;
  try {
    const body = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as Partial<StepUpPayload>;
    if (body.v !== 1 || body.method !== "passkey") return false;
    if (body.uid !== userId || body.sid !== sessionId) return false;
    if (typeof body.exp !== "number" || body.exp < Date.now() / 1000) return false;
    return true;
  } catch {
    return false;
  }
}
