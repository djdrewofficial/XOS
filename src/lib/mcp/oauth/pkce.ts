import { createHash, timingSafeEqual } from "node:crypto";

/** RFC 7636 S256: BASE64URL(SHA256(verifier)). */
export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  if (verifier.length < 43 || verifier.length > 128) return false;
  const expected = s256Challenge(verifier);
  const left = Buffer.from(expected);
  const right = Buffer.from(challenge);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isS256Method(method: string | null | undefined): boolean {
  return method === "S256";
}
