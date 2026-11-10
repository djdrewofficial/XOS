import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "xos_mcp_";

/** Raw bearer token. Shown once at mint time and never stored. */
export function generateServiceToken(): { raw: string; hash: string; prefix: string } {
  const raw = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, 16) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function looksLikeServiceToken(raw: string): boolean {
  return raw.startsWith(TOKEN_PREFIX) && raw.length >= TOKEN_PREFIX.length + 20;
}

/** Stable JSON for argument binding. Key order does not matter. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortValue(obj[key]);
    return out;
  }
  return value;
}
