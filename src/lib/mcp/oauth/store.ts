import { randomBytes, randomUUID } from "node:crypto";
import { hashToken } from "../crypto";
import type {
  OAuthAccessTokenRow,
  OAuthAuthCodeRow,
  OAuthClientRow,
  OAuthGrantTokenRow,
  OAuthPendingRow,
  OAuthRefreshTokenRow,
} from "./types";

export type OAuthStore = {
  findClient(clientId: string): Promise<OAuthClientRow | null>;
  insertClient(row: Omit<OAuthClientRow, "id" | "created_at" | "revoked_at"> & { id?: string }): Promise<OAuthClientRow>;
  insertPending(row: Omit<OAuthPendingRow, "id" | "created_at" | "consumed_at"> & { id?: string }): Promise<OAuthPendingRow>;
  findPending(id: string): Promise<OAuthPendingRow | null>;
  consumePending(id: string, now: Date): Promise<OAuthPendingRow | null>;
  insertGrant(row: {
    name: string;
    scopes: string[];
    oauthClientId: string;
    oauthClientName: string;
    approvedBy: string;
    now: Date;
  }): Promise<OAuthGrantTokenRow>;
  findGrant(id: string): Promise<OAuthGrantTokenRow | null>;
  revokeGrant(id: string, now: Date): Promise<void>;
  insertAuthCode(row: Omit<OAuthAuthCodeRow, "id" | "created_at" | "used_at"> & { id?: string }): Promise<OAuthAuthCodeRow>;
  findAuthCodeByHash(hash: string): Promise<OAuthAuthCodeRow | null>;
  markAuthCodeUsed(id: string, now: Date): Promise<OAuthAuthCodeRow | null>;
  /** Returns the previous used_at row without changing it (for reuse detection). */
  getAuthCode(id: string): Promise<OAuthAuthCodeRow | null>;
  insertAccessToken(row: Omit<OAuthAccessTokenRow, "id" | "created_at" | "revoked_at"> & { id?: string }): Promise<OAuthAccessTokenRow>;
  findAccessByHash(hash: string): Promise<OAuthAccessTokenRow | null>;
  revokeAccessForGrant(grantTokenId: string, now: Date): Promise<void>;
  insertRefreshToken(row: Omit<OAuthRefreshTokenRow, "id" | "created_at" | "revoked_at" | "replaced_by_id"> & { id?: string }): Promise<OAuthRefreshTokenRow>;
  findRefreshByHash(hash: string): Promise<OAuthRefreshTokenRow | null>;
  revokeRefresh(id: string, now: Date, replacedById?: string | null): Promise<void>;
  revokeRefreshForGrant(grantTokenId: string, now: Date): Promise<void>;
  getApproverRoles(): Promise<string[]>;
};

export function memoryOAuthStore(seed?: { approverRoles?: string[] }): {
  store: OAuthStore;
  grants: OAuthGrantTokenRow[];
  clients: OAuthClientRow[];
  access: OAuthAccessTokenRow[];
  refresh: OAuthRefreshTokenRow[];
  codes: OAuthAuthCodeRow[];
} {
  const clients: OAuthClientRow[] = [];
  const pending: OAuthPendingRow[] = [];
  const grants: OAuthGrantTokenRow[] = [];
  const codes: OAuthAuthCodeRow[] = [];
  const access: OAuthAccessTokenRow[] = [];
  const refresh: OAuthRefreshTokenRow[] = [];
  const approverRoles = seed?.approverRoles ?? ["master_admin"];

  const store: OAuthStore = {
    async findClient(clientId) {
      return clients.find((c) => c.client_id === clientId && !c.revoked_at) ?? null;
    },
    async insertClient(row) {
      const created: OAuthClientRow = {
        id: row.id ?? randomUUID(),
        client_id: row.client_id,
        client_secret_hash: row.client_secret_hash,
        client_name: row.client_name,
        redirect_uris: row.redirect_uris,
        grant_types: row.grant_types,
        response_types: row.response_types,
        token_endpoint_auth_method: row.token_endpoint_auth_method,
        created_at: new Date().toISOString(),
        revoked_at: null,
      };
      clients.push(created);
      return created;
    },
    async insertPending(row) {
      const created: OAuthPendingRow = {
        id: row.id ?? randomUUID(),
        client_id: row.client_id,
        redirect_uri: row.redirect_uri,
        scope: row.scope,
        state: row.state,
        code_challenge: row.code_challenge,
        code_challenge_method: row.code_challenge_method,
        resource: row.resource,
        created_at: new Date().toISOString(),
        expires_at: row.expires_at,
        consumed_at: null,
      };
      pending.push(created);
      return created;
    },
    async findPending(id) {
      return pending.find((p) => p.id === id) ?? null;
    },
    async consumePending(id, now) {
      const row = pending.find((p) => p.id === id);
      if (!row || row.consumed_at) return null;
      if (Date.parse(row.expires_at) <= now.getTime()) return null;
      row.consumed_at = now.toISOString();
      return row;
    },
    async insertGrant(row) {
      const created: OAuthGrantTokenRow = {
        id: randomUUID(),
        name: row.name,
        scopes: row.scopes,
        expires_at: null,
        revoked_at: null,
        overlap_until: null,
        token_hash: hashToken(`oauth-placeholder-${randomBytes(32).toString("hex")}`),
        auth_kind: "oauth",
        oauth_client_id: row.oauthClientId,
        oauth_client_name: row.oauthClientName,
        approved_by: row.approvedBy,
      };
      grants.push(created);
      return created;
    },
    async findGrant(id) {
      return grants.find((g) => g.id === id) ?? null;
    },
    async revokeGrant(id, now) {
      const row = grants.find((g) => g.id === id);
      if (row) {
        row.revoked_at = now.toISOString();
        row.overlap_until = now.toISOString();
      }
      await store.revokeAccessForGrant(id, now);
      await store.revokeRefreshForGrant(id, now);
    },
    async insertAuthCode(row) {
      const created: OAuthAuthCodeRow = {
        id: row.id ?? randomUUID(),
        code_hash: row.code_hash,
        client_id: row.client_id,
        redirect_uri: row.redirect_uri,
        scopes: row.scopes,
        code_challenge: row.code_challenge,
        code_challenge_method: row.code_challenge_method,
        resource: row.resource,
        grant_token_id: row.grant_token_id,
        created_at: new Date().toISOString(),
        expires_at: row.expires_at,
        used_at: null,
      };
      codes.push(created);
      return created;
    },
    async findAuthCodeByHash(hash) {
      return codes.find((c) => c.code_hash === hash) ?? null;
    },
    async markAuthCodeUsed(id, now) {
      const row = codes.find((c) => c.id === id);
      if (!row || row.used_at) return null;
      row.used_at = now.toISOString();
      return row;
    },
    async getAuthCode(id) {
      return codes.find((c) => c.id === id) ?? null;
    },
    async insertAccessToken(row) {
      const created: OAuthAccessTokenRow = {
        id: row.id ?? randomUUID(),
        token_hash: row.token_hash,
        grant_token_id: row.grant_token_id,
        client_id: row.client_id,
        scopes: row.scopes,
        resource: row.resource,
        created_at: new Date().toISOString(),
        expires_at: row.expires_at,
        revoked_at: null,
      };
      access.push(created);
      return created;
    },
    async findAccessByHash(hash) {
      return access.find((a) => a.token_hash === hash) ?? null;
    },
    async revokeAccessForGrant(grantTokenId, now) {
      for (const row of access) {
        if (row.grant_token_id === grantTokenId && !row.revoked_at) {
          row.revoked_at = now.toISOString();
        }
      }
    },
    async insertRefreshToken(row) {
      const created: OAuthRefreshTokenRow = {
        id: row.id ?? randomUUID(),
        token_hash: row.token_hash,
        grant_token_id: row.grant_token_id,
        client_id: row.client_id,
        scopes: row.scopes,
        resource: row.resource,
        created_at: new Date().toISOString(),
        expires_at: row.expires_at,
        revoked_at: null,
        replaced_by_id: null,
      };
      refresh.push(created);
      return created;
    },
    async findRefreshByHash(hash) {
      return refresh.find((r) => r.token_hash === hash) ?? null;
    },
    async revokeRefresh(id, now, replacedById = null) {
      const row = refresh.find((r) => r.id === id);
      if (row) {
        row.revoked_at = now.toISOString();
        if (replacedById) row.replaced_by_id = replacedById;
      }
    },
    async revokeRefreshForGrant(grantTokenId, now) {
      for (const row of refresh) {
        if (row.grant_token_id === grantTokenId && !row.revoked_at) {
          row.revoked_at = now.toISOString();
        }
      }
    },
    async getApproverRoles() {
      return [...approverRoles];
    },
  };

  return { store, grants, clients, access, refresh, codes };
}

/** Mutate approver roles in a memory store (tests / seed helpers). */
export function setMemoryApproverRoles(store: OAuthStore, roles: string[]) {
  (store as { getApproverRoles: () => Promise<string[]> }).getApproverRoles = async () => [...roles];
}
