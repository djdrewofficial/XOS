/* Short-lived signed snapshot of the permission gate.

   Middleware used to query accounts, employees, and permission tables on every
   request, including every button's server action. This cookie lets the next
   minute of requests skip those reads. It is httpOnly and HMAC-signed with a
   server secret, so a browser cannot edit its role. It is a route gate only:
   server actions still call getMe() against the database, and RLS still applies.

   If the secret is not configured the cache is off and middleware behaves as
   before. Permission changes take effect within TTL_SEC. */

export const PERM_COOKIE = "xos_access";
export const PERM_TTL_SEC = 60;

export type PermAccountType = "staff" | "client" | "event_guest";

export type PermSnap = {
  uid: string;
  exp: number;
  accountType: PermAccountType;
  role: string;
  empId: string | null;
  /** Omitted for master_admin (the gate bypasses the map). */
  can?: Record<string, string>;
};

export function permCacheSecret(): string | undefined {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET;
  return secret && secret.length >= 16 ? secret : undefined;
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
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signPermSnap(snap: PermSnap, secret: string): Promise<string> {
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify(snap)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${bytesToB64url(new Uint8Array(sig))}`;
}

/** Verify signature, expiry, and that the snapshot belongs to this user. */
export async function readPermSnap(
  token: string | undefined,
  secret: string | undefined,
  uid: string,
): Promise<PermSnap | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      b64urlToBytes(sig) as BufferSource,
      new TextEncoder().encode(payload),
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const snap = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as PermSnap;
    if (!snap || snap.uid !== uid || typeof snap.exp !== "number") return null;
    if (snap.exp < Date.now() / 1000) return null;
    if (snap.accountType !== "staff" && snap.accountType !== "client" && snap.accountType !== "event_guest") {
      return null;
    }
    if (typeof snap.role !== "string") return null;
    if (snap.empId !== null && typeof snap.empId !== "string") return null;
    return snap;
  } catch {
    return null;
  }
}
