import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken } from "../crypto";
import type { OAuthStore } from "./store";
import type {
  OAuthAccessTokenRow,
  OAuthAuthCodeRow,
  OAuthClientRow,
  OAuthGrantTokenRow,
  OAuthPendingRow,
  OAuthRefreshTokenRow,
} from "./types";

const CLIENT_COLS =
  "id, client_id, client_secret_hash, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at, revoked_at";
const PENDING_COLS =
  "id, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, resource, created_at, expires_at, consumed_at";
const CODE_COLS =
  "id, code_hash, client_id, redirect_uri, scopes, code_challenge, code_challenge_method, resource, grant_token_id, created_at, expires_at, used_at";
const ACCESS_COLS =
  "id, token_hash, grant_token_id, client_id, scopes, resource, created_at, expires_at, revoked_at";
const REFRESH_COLS =
  "id, token_hash, grant_token_id, client_id, scopes, resource, created_at, expires_at, revoked_at, replaced_by_id";
const GRANT_COLS =
  "id, name, scopes, expires_at, revoked_at, overlap_until, token_hash, auth_kind, oauth_client_id, oauth_client_name, approved_by, helpers_skip_xos_approval, auto_approve";

export function supabaseOAuthStore(admin: SupabaseClient): OAuthStore {
  return {
    async findClient(clientId) {
      const { data, error } = await admin
        .from("mcp_oauth_clients")
        .select(CLIENT_COLS)
        .eq("client_id", clientId)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw new Error("Could not look up the OAuth client.");
      return (data as OAuthClientRow | null) ?? null;
    },

    async insertClient(row) {
      const { data, error } = await admin
        .from("mcp_oauth_clients")
        .insert({
          client_id: row.client_id,
          client_secret_hash: row.client_secret_hash,
          client_name: row.client_name,
          redirect_uris: row.redirect_uris,
          grant_types: row.grant_types,
          response_types: row.response_types,
          token_endpoint_auth_method: row.token_endpoint_auth_method,
        })
        .select(CLIENT_COLS)
        .single();
      if (error || !data) throw new Error("Could not register the OAuth client.");
      return data as OAuthClientRow;
    },

    async insertPending(row) {
      const { data, error } = await admin
        .from("mcp_oauth_pending")
        .insert({
          client_id: row.client_id,
          redirect_uri: row.redirect_uri,
          scope: row.scope,
          state: row.state,
          code_challenge: row.code_challenge,
          code_challenge_method: row.code_challenge_method,
          resource: row.resource,
          expires_at: row.expires_at,
        })
        .select(PENDING_COLS)
        .single();
      if (error || !data) throw new Error("Could not store the authorization request.");
      return data as OAuthPendingRow;
    },

    async findPending(id) {
      const { data, error } = await admin.from("mcp_oauth_pending").select(PENDING_COLS).eq("id", id).maybeSingle();
      if (error) throw new Error("Could not read the authorization request.");
      return (data as OAuthPendingRow | null) ?? null;
    },

    async consumePending(id, now) {
      const { data, error } = await admin
        .from("mcp_oauth_pending")
        .update({ consumed_at: now.toISOString() })
        .eq("id", id)
        .is("consumed_at", null)
        .gt("expires_at", now.toISOString())
        .select(PENDING_COLS)
        .maybeSingle();
      if (error) throw new Error("Could not consume the authorization request.");
      return (data as OAuthPendingRow | null) ?? null;
    },

    async insertGrant(row) {
      const placeholder = hashToken(`oauth-placeholder-${row.oauthClientId}-${row.now.toISOString()}-${Math.random()}`);
      const { data, error } = await admin
        .from("mcp_service_tokens")
        .insert({
          name: row.name,
          token_prefix: "oauth_",
          token_hash: placeholder,
          scopes: row.scopes,
          created_by: row.approvedBy,
          auth_kind: "oauth",
          oauth_client_id: row.oauthClientId,
          oauth_client_name: row.oauthClientName,
          approved_by: row.approvedBy,
        })
        .select(GRANT_COLS)
        .single();
      if (error || !data) throw new Error("Could not create the OAuth grant identity.");
      return data as OAuthGrantTokenRow;
    },

    async findGrant(id) {
      const { data, error } = await admin
        .from("mcp_service_tokens")
        .select(GRANT_COLS)
        .eq("id", id)
        .eq("auth_kind", "oauth")
        .maybeSingle();
      if (error) throw new Error("Could not read the OAuth grant.");
      return (data as OAuthGrantTokenRow | null) ?? null;
    },

    async revokeGrant(id, now) {
      const at = now.toISOString();
      const { error } = await admin
        .from("mcp_service_tokens")
        .update({ revoked_at: at, overlap_until: at })
        .eq("id", id);
      if (error) throw new Error("Could not revoke the OAuth grant.");
      await this.revokeAccessForGrant(id, now);
      await this.revokeRefreshForGrant(id, now);
    },

    async insertAuthCode(row) {
      const { data, error } = await admin
        .from("mcp_oauth_auth_codes")
        .insert({
          code_hash: row.code_hash,
          client_id: row.client_id,
          redirect_uri: row.redirect_uri,
          scopes: row.scopes,
          code_challenge: row.code_challenge,
          code_challenge_method: row.code_challenge_method,
          resource: row.resource,
          grant_token_id: row.grant_token_id,
          expires_at: row.expires_at,
        })
        .select(CODE_COLS)
        .single();
      if (error || !data) throw new Error("Could not store the authorization code.");
      return data as OAuthAuthCodeRow;
    },

    async findAuthCodeByHash(hash) {
      const { data, error } = await admin.from("mcp_oauth_auth_codes").select(CODE_COLS).eq("code_hash", hash).maybeSingle();
      if (error) throw new Error("Could not look up the authorization code.");
      return (data as OAuthAuthCodeRow | null) ?? null;
    },

    async markAuthCodeUsed(id, now) {
      const { data, error } = await admin
        .from("mcp_oauth_auth_codes")
        .update({ used_at: now.toISOString() })
        .eq("id", id)
        .is("used_at", null)
        .select(CODE_COLS)
        .maybeSingle();
      if (error) throw new Error("Could not mark the authorization code used.");
      return (data as OAuthAuthCodeRow | null) ?? null;
    },

    async getAuthCode(id) {
      const { data, error } = await admin.from("mcp_oauth_auth_codes").select(CODE_COLS).eq("id", id).maybeSingle();
      if (error) throw new Error("Could not read the authorization code.");
      return (data as OAuthAuthCodeRow | null) ?? null;
    },

    async insertAccessToken(row) {
      const { data, error } = await admin
        .from("mcp_oauth_access_tokens")
        .insert({
          token_hash: row.token_hash,
          grant_token_id: row.grant_token_id,
          client_id: row.client_id,
          scopes: row.scopes,
          resource: row.resource,
          expires_at: row.expires_at,
        })
        .select(ACCESS_COLS)
        .single();
      if (error || !data) throw new Error("Could not store the access token.");
      return data as OAuthAccessTokenRow;
    },

    async findAccessByHash(hash) {
      const { data, error } = await admin.from("mcp_oauth_access_tokens").select(ACCESS_COLS).eq("token_hash", hash).maybeSingle();
      if (error) throw new Error("Could not look up the access token.");
      return (data as OAuthAccessTokenRow | null) ?? null;
    },

    async revokeAccessForGrant(grantTokenId, now) {
      const { error } = await admin
        .from("mcp_oauth_access_tokens")
        .update({ revoked_at: now.toISOString() })
        .eq("grant_token_id", grantTokenId)
        .is("revoked_at", null);
      if (error) throw new Error("Could not revoke access tokens.");
    },

    async insertRefreshToken(row) {
      const { data, error } = await admin
        .from("mcp_oauth_refresh_tokens")
        .insert({
          token_hash: row.token_hash,
          grant_token_id: row.grant_token_id,
          client_id: row.client_id,
          scopes: row.scopes,
          resource: row.resource,
          expires_at: row.expires_at,
        })
        .select(REFRESH_COLS)
        .single();
      if (error || !data) throw new Error("Could not store the refresh token.");
      return data as OAuthRefreshTokenRow;
    },

    async findRefreshByHash(hash) {
      const { data, error } = await admin.from("mcp_oauth_refresh_tokens").select(REFRESH_COLS).eq("token_hash", hash).maybeSingle();
      if (error) throw new Error("Could not look up the refresh token.");
      return (data as OAuthRefreshTokenRow | null) ?? null;
    },

    async revokeRefresh(id, now, replacedById = null) {
      const { error } = await admin
        .from("mcp_oauth_refresh_tokens")
        .update({ revoked_at: now.toISOString(), replaced_by_id: replacedById })
        .eq("id", id);
      if (error) throw new Error("Could not revoke the refresh token.");
    },

    async revokeRefreshForGrant(grantTokenId, now) {
      const { error } = await admin
        .from("mcp_oauth_refresh_tokens")
        .update({ revoked_at: now.toISOString() })
        .eq("grant_token_id", grantTokenId)
        .is("revoked_at", null);
      if (error) throw new Error("Could not revoke refresh tokens.");
    },

    async getApproverRoles() {
      const { data, error } = await admin.from("mcp_oauth_settings").select("approver_roles").eq("id", true).maybeSingle();
      if (error || !data) return ["master_admin"];
      const roles = (data.approver_roles as string[] | null) ?? [];
      return roles.length ? roles : ["master_admin"];
    },
  };
}
