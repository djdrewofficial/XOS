import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceTokenRow } from "./auth";
import type { AuditRow, ConfirmationRow, IdempotencyRow, McpStore } from "./store";

/** Service-role access to the MCP tables. The raw bearer token is never written. */
export function supabaseStore(admin: SupabaseClient): McpStore {
  return {
    async findTokenByHash(hash) {
      const { data, error } = await admin
        .from("mcp_service_tokens")
        .select("id, name, scopes, expires_at, revoked_at, overlap_until, token_hash")
        .eq("token_hash", hash)
        .maybeSingle();
      if (error) throw new Error("Could not look up the service token.");
      return (data as ServiceTokenRow | null) ?? null;
    },
    async touchToken(id, at) {
      await admin.from("mcp_service_tokens").update({ last_used_at: at.toISOString() }).eq("id", id);
    },
    async insertAudit(row: AuditRow) {
      await admin.from("mcp_audit_log").insert({
        token_id: row.tokenId,
        token_name: row.tokenName,
        tool_name: row.toolName,
        args_redacted: row.argsRedacted ?? null,
        status: row.status,
        error_code: row.errorCode,
        duration_ms: row.durationMs,
        confirmation_id: row.confirmationId,
        idempotency_key: row.idempotencyKey,
        request_id: row.requestId,
      });
    },
    async audits() {
      return [];
    },
    async hitRateLimit(bucket, key, max, windowMs, now) {
      const since = new Date(now.getTime() - windowMs).toISOString();
      const { count } = await admin
        .from("rate_limit_hits")
        .select("id", { count: "exact", head: true })
        .eq("bucket", bucket)
        .eq("key", key)
        .gt("created_at", since);
      if ((count ?? 0) >= max) return true;
      await admin.from("rate_limit_hits").insert({ bucket, key });
      return false;
    },
    async createConfirmation(row) {
      const { data, error } = await admin
        .from("mcp_confirmations")
        .insert({
          token_id: row.tokenId,
          tool_name: row.toolName,
          args_hash: row.argsHash,
          args: row.args,
          preview: row.preview,
          expires_at: row.expiresAt,
        })
        .select("id, token_id, tool_name, args_hash, args, preview, expires_at, used_at")
        .single();
      if (error || !data) throw new Error("Could not store the confirmation.");
      return mapConfirmation(data);
    },
    async getConfirmation(id) {
      const { data } = await admin
        .from("mcp_confirmations")
        .select("id, token_id, tool_name, args_hash, args, preview, expires_at, used_at")
        .eq("id", id)
        .maybeSingle();
      return data ? mapConfirmation(data) : null;
    },
    async consumeConfirmation(id, now) {
      const { data } = await admin
        .from("mcp_confirmations")
        .update({ used_at: now.toISOString() })
        .eq("id", id)
        .is("used_at", null)
        .select("id, token_id, tool_name, args_hash, args, preview, expires_at, used_at")
        .maybeSingle();
      return data ? mapConfirmation(data) : null;
    },
    async getIdempotency(tokenId, key) {
      const { data } = await admin
        .from("mcp_idempotency_keys")
        .select("tool_name, args_hash, response, created_at")
        .eq("token_id", tokenId)
        .eq("idempotency_key", key)
        .maybeSingle();
      if (!data) return null;
      return {
        toolName: data.tool_name as string,
        argsHash: data.args_hash as string,
        response: data.response,
        createdAt: data.created_at as string,
      } satisfies IdempotencyRow;
    },
    async saveIdempotency(tokenId, key, row) {
      await admin.from("mcp_idempotency_keys").upsert(
        {
          token_id: tokenId,
          idempotency_key: key,
          tool_name: row.toolName,
          args_hash: row.argsHash,
          response: row.response,
        },
        { onConflict: "token_id,idempotency_key", ignoreDuplicates: true },
      );
    },
  };
}

function mapConfirmation(data: Record<string, unknown>): ConfirmationRow {
  return {
    id: data.id as string,
    tokenId: data.token_id as string,
    toolName: data.tool_name as string,
    argsHash: data.args_hash as string,
    args: (data.args ?? {}) as Record<string, unknown>,
    preview: data.preview,
    expiresAt: data.expires_at as string,
    usedAt: (data.used_at as string | null) ?? null,
  };
}
