export type ServiceTokenRow = {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  overlap_until: string | null;
  token_hash: string;
};

export type TokenDecision =
  | { ok: true }
  | { ok: false; reason: "revoked" | "expired" | "overlap_ended" };

/** A token works until it is revoked, past its expiry, or past the overlap
    window set when it was rotated. overlap_until null means it has not been rotated. */
export function tokenDecision(row: Pick<ServiceTokenRow, "revoked_at" | "expires_at" | "overlap_until">, now: Date): TokenDecision {
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) return { ok: false, reason: "expired" };
  if (row.overlap_until && Date.parse(row.overlap_until) <= now.getTime()) return { ok: false, reason: "overlap_ended" };
  return { ok: true };
}
