import type { ServiceTokenRow } from "./auth";
import {
  decideIdempotency,
  idempotencyKeyError,
  type IdempotencyDecision,
  type IdempotencySnapshot,
  type IdempotencyStatus,
} from "./idempotency";

export type AuditRow = {
  tokenId: string | null;
  tokenName: string | null;
  toolName: string | null;
  argsRedacted: unknown;
  status: string;
  errorCode: string | null;
  durationMs: number | null;
  confirmationId: string | null;
  idempotencyKey: string | null;
  requestId: string | null;
};

export type ConfirmationRow = {
  id: string;
  tokenId: string;
  toolName: string;
  argsHash: string;
  args: Record<string, unknown>;
  preview: unknown;
  expiresAt: string;
  usedAt: string | null;
  /** Set only by a signed-in XOS staff session. An agent token cannot write this. */
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  result: unknown;
  /** pending until a person claims it, then executing, then a terminal state. */
  status: "pending" | "executing" | "completed" | "failed" | "uncertain";
  idempotencyKey: string | null;
};

export type IdempotencyRow = IdempotencySnapshot;

export interface McpStore {
  findTokenByHash(hash: string): Promise<ServiceTokenRow | null>;
  touchToken(id: string, at: Date): Promise<void>;
  insertAudit(row: AuditRow): Promise<void>;
  audits(): Promise<AuditRow[]>;
  /** True when the key is already at `max` inside the window. Records a hit only when allowed. */
  hitRateLimit(bucket: string, key: string, max: number, windowMs: number, now: Date): Promise<boolean>;
  createConfirmation(row: Omit<ConfirmationRow, "id" | "usedAt" | "approvedAt" | "approvedBy" | "rejectedAt" | "rejectedBy" | "result" | "status"> & { id?: string; status?: ConfirmationRow["status"] }): Promise<ConfirmationRow>;
  getConfirmation(id: string): Promise<ConfirmationRow | null>;
  /** The preview created for this token and key, if the arguments still match. */
  findOperation(tokenId: string, idempotencyKey: string): Promise<ConfirmationRow | null>;
  /** Atomically moves pending -> executing. Null when it is not claimable. */
  claimExecution(id: string, userId: string, now: Date): Promise<ConfirmationRow | null>;
  finishOperation(id: string, status: "completed" | "failed" | "uncertain", result: unknown, now: Date): Promise<void>;
  /** Staff session only. Does not run the tool. */
  decideConfirmation(id: string, decision: { userId: string; now: Date; kind: "approve" | "reject" }): Promise<ConfirmationRow | null>;
  saveConfirmationResult(id: string, result: unknown): Promise<void>;
  /** Marks the confirmation used if it is still unused. Returns null when it was already used. */
  consumeConfirmation(id: string, now: Date): Promise<ConfirmationRow | null>;
  /** Claims the key before any effect. Concurrent callers cannot both receive "owned". */
  reserveIdempotency(tokenId: string, key: string, toolName: string, argsHash: string, now: Date, ttlMs: number): Promise<IdempotencyDecision>;
  finishIdempotency(tokenId: string, key: string, status: IdempotencyStatus, response: unknown): Promise<void>;
}

export function memoryStore(): { store: McpStore; addToken(row: ServiceTokenRow): void } {
  const tokens: ServiceTokenRow[] = [];
  const audit: AuditRow[] = [];
  const hits: { bucket: string; key: string; at: number }[] = [];
  const confirmations: ConfirmationRow[] = [];
  const idem = new Map<string, IdempotencyRow>();
  let seq = 0;

  const store: McpStore = {
    async findTokenByHash(hash) {
      return tokens.find((row) => row.token_hash === hash) ?? null;
    },
    async touchToken(id, at) {
      const row = tokens.find((token) => token.id === id);
      if (row) row.expires_at = row.expires_at;
      void at;
      void id;
    },
    async insertAudit(row) {
      audit.push(row);
    },
    async audits() {
      return audit.slice();
    },
    async hitRateLimit(bucket, key, max, windowMs, now) {
      const cutoff = now.getTime() - windowMs;
      hits.push({ bucket, key, at: now.getTime() });
      const recent = hits.filter((hit) => hit.bucket === bucket && hit.key === key && hit.at > cutoff);
      if (recent.length > max) {
        hits.pop();
        return true;
      }
      return false;
    },
    async createConfirmation(row) {
      const saved: ConfirmationRow = {
        id: row.id ?? `cnf_${++seq}`,
        tokenId: row.tokenId,
        toolName: row.toolName,
        argsHash: row.argsHash,
        args: row.args,
        preview: row.preview,
        expiresAt: row.expiresAt,
        usedAt: null,
        approvedAt: null,
        approvedBy: null,
        rejectedAt: null,
        rejectedBy: null,
        result: null,
        status: row.status ?? "pending",
        idempotencyKey: row.idempotencyKey ?? null,
      };
      confirmations.push(saved);
      return saved;
    },
    async decideConfirmation(id, decision) {
      const row = confirmations.find((item) => item.id === id);
      if (!row || row.usedAt || row.rejectedAt) return null;
      if (Date.parse(row.expiresAt) <= decision.now.getTime()) return null;
      if (!decision.userId) return null;
      if (decision.kind === "reject") {
        row.rejectedAt = decision.now.toISOString();
        row.rejectedBy = decision.userId;
      } else if (!row.approvedAt) {
        row.approvedAt = decision.now.toISOString();
        row.approvedBy = decision.userId;
      }
      return { ...row, args: { ...row.args } };
    },
    async saveConfirmationResult(id, result) {
      const row = confirmations.find((item) => item.id === id);
      if (row) row.result = result;
    },
    async findOperation(tokenId, idempotencyKey) {
      const row = confirmations.find((item) => item.tokenId === tokenId && item.idempotencyKey === idempotencyKey);
      return row ? { ...row, args: { ...row.args } } : null;
    },
    async claimExecution(id, userId, now) {
      const row = confirmations.find((item) => item.id === id);
      if (!row || row.status !== "pending" || row.rejectedAt || row.usedAt) return null;
      if (Date.parse(row.expiresAt) <= now.getTime()) return null;
      if (!userId) return null;
      row.status = "executing";
      row.approvedAt = now.toISOString();
      row.approvedBy = userId;
      return { ...row, args: { ...row.args } };
    },
    async finishOperation(id, status, result, now) {
      const row = confirmations.find((item) => item.id === id);
      if (!row) return;
      row.status = status;
      row.result = result;
      row.usedAt = now.toISOString();
    },
    async getConfirmation(id) {
      const row = confirmations.find((item) => item.id === id);
      return row ? { ...row, args: { ...row.args } } : null;
    },
    async consumeConfirmation(id, now) {
      const row = confirmations.find((item) => item.id === id);
      if (!row || row.usedAt) return null;
      row.usedAt = now.toISOString();
      return { ...row, args: { ...row.args } };
    },
    async reserveIdempotency(tokenId, key, toolName, argsHash, now, ttlMs) {
      if (idempotencyKeyError(key)) return { kind: "invalid_key" };
      const mapKey = `${tokenId}:${key}`;
      const existing = idem.get(mapKey) ?? null;
      const decision = decideIdempotency({
        existing,
        toolName,
        argsHash,
        now: now.getTime(),
        ttlMs,
      });
      if (decision.kind === "owned") {
        idem.set(mapKey, {
          toolName,
          argsHash,
          response: null,
          createdAt: now.toISOString(),
          status: "running",
        });
      }
      return decision;
    },
    async finishIdempotency(tokenId, key, status, response) {
      const mapKey = `${tokenId}:${key}`;
      const existing = idem.get(mapKey);
      if (!existing) return;
      existing.status = status;
      existing.response = response;
    },
  };

  return {
    store,
    addToken(row) {
      tokens.push(row);
    },
  };
}
