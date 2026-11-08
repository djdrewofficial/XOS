import type { ServiceTokenRow } from "./auth";

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
};

export type IdempotencyRow = {
  toolName: string;
  argsHash: string;
  response: unknown;
  createdAt: string;
};

export interface McpStore {
  findTokenByHash(hash: string): Promise<ServiceTokenRow | null>;
  touchToken(id: string, at: Date): Promise<void>;
  insertAudit(row: AuditRow): Promise<void>;
  audits(): Promise<AuditRow[]>;
  /** True when the key is already at `max` inside the window. Records a hit only when allowed. */
  hitRateLimit(bucket: string, key: string, max: number, windowMs: number, now: Date): Promise<boolean>;
  createConfirmation(row: Omit<ConfirmationRow, "id" | "usedAt"> & { id?: string }): Promise<ConfirmationRow>;
  getConfirmation(id: string): Promise<ConfirmationRow | null>;
  /** Marks the confirmation used if it is still unused. Returns null when it was already used. */
  consumeConfirmation(id: string, now: Date): Promise<ConfirmationRow | null>;
  getIdempotency(tokenId: string, key: string): Promise<IdempotencyRow | null>;
  saveIdempotency(tokenId: string, key: string, row: Omit<IdempotencyRow, "createdAt">, now: Date): Promise<void>;
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
      const recent = hits.filter((hit) => hit.bucket === bucket && hit.key === key && hit.at > cutoff);
      if (recent.length >= max) return true;
      hits.push({ bucket, key, at: now.getTime() });
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
      };
      confirmations.push(saved);
      return saved;
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
    async getIdempotency(tokenId, key) {
      return idem.get(`${tokenId}:${key}`) ?? null;
    },
    async saveIdempotency(tokenId, key, row, now) {
      const existing = idem.get(`${tokenId}:${key}`);
      if (existing) return;
      idem.set(`${tokenId}:${key}`, { ...row, createdAt: now.toISOString() });
    },
  };

  return {
    store,
    addToken(row) {
      tokens.push(row);
    },
  };
}
