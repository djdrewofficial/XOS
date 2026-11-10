/** Idempotency decisions. The store applies the "owned" transition before any effect
    and before its next await, so two overlapping calls cannot both be owners. */

export const IDEMPOTENCY_KEY_MIN = 8;
export const IDEMPOTENCY_KEY_MAX = 200;
export const IDEMPOTENCY_UNCERTAIN_MS = 2 * 60 * 1000;

export type IdempotencyStatus = "running" | "completed" | "failed" | "uncertain";

export type IdempotencySnapshot = {
  toolName: string;
  argsHash: string;
  response: unknown;
  createdAt: string;
  status: IdempotencyStatus;
};

export type IdempotencyDecision =
  | { kind: "invalid_key" }
  | { kind: "owned" }
  | { kind: "replay"; response: unknown }
  | { kind: "mismatch" }
  | { kind: "in_progress" }
  | { kind: "uncertain" };

export function idempotencyKeyError(key: string): string | null {
  if (key.length < IDEMPOTENCY_KEY_MIN || key.length > IDEMPOTENCY_KEY_MAX) {
    return `Idempotency key must be ${IDEMPOTENCY_KEY_MIN} to ${IDEMPOTENCY_KEY_MAX} characters.`;
  }
  if (/[\s\u0000-\u001f]/.test(key)) return "Idempotency key cannot contain whitespace.";
  return null;
}

export function decideIdempotency(input: {
  existing: IdempotencySnapshot | null;
  toolName: string;
  argsHash: string;
  now: number;
  ttlMs: number;
}): IdempotencyDecision {
  const row = input.existing;
  if (!row) return { kind: "owned" };
  if (row.toolName !== input.toolName || row.argsHash !== input.argsHash) return { kind: "mismatch" };
  const age = input.now - Date.parse(row.createdAt);
  if (row.status === "completed" || row.status === "failed") {
    if (age > input.ttlMs) return { kind: "owned" };
    return { kind: "replay", response: row.response };
  }
  if (row.status === "running" && age <= IDEMPOTENCY_UNCERTAIN_MS) return { kind: "in_progress" };
  return { kind: "uncertain" };
}
