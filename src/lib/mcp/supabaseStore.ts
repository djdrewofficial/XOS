import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceTokenRow } from "./auth";
import { decideIdempotency, idempotencyKeyError, type IdempotencyStatus } from "./idempotency";
import type { AuditRow, ConfirmationRow, IdempotencyRow, McpStore } from "./store";

const CONFIRMATION_COLUMNS =
  "id, token_id, tool_name, args_hash, args, preview, expires_at, used_at, approved_at, approved_by, rejected_at, rejected_by, result, status, idempotency_key";

/** Service-role access to the MCP tables. The raw bearer token is never written.
    Rate-limit and audit errors throw so the caller can fail closed. */
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
      const { error } = await admin.from("mcp_audit_log").insert({
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
      if (error) throw new Error("Audit log write failed.");
    },
    async audits() {
      return [];
    },
    async hitRateLimit(bucket, key, max, windowMs) {
      const { data, error } = await admin.rpc("mcp_rate_hit", {
        p_bucket: bucket,
        p_key: key,
        p_max: max,
        p_window_ms: windowMs,
      });
      if (error) throw new Error("Rate limit unavailable.");
      return data === true;
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
          status: "pending",
          idempotency_key: row.idempotencyKey,
        })
        .select(CONFIRMATION_COLUMNS)
        .single();
      if (error || !data) throw new Error("Could not store the confirmation.");
      return mapConfirmation(data);
    },
    async findOperation(tokenId, idempotencyKey) {
      const { data, error } = await admin
        .from("mcp_confirmations")
        .select(CONFIRMATION_COLUMNS)
        .eq("token_id", tokenId)
        .eq("idempotency_key", idempotencyKey)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("Could not read the operation.");
      return data ? mapConfirmation(data) : null;
    },
    async claimExecution(id, userId) {
      const { data, error } = await admin.rpc("mcp_claim_operation", { p_id: id, p_user: userId });
      if (error) {
        if (/token inactive/i.test(error.message)) throw new Error("The agent token is not active.");
        if (/not claimable|expired/i.test(error.message)) return null;
        throw new Error(error.message);
      }
      return data ? mapConfirmation(data as Record<string, unknown>) : null;
    },
    async finishOperation(id, status, result, now) {
      const { error } = await admin
        .from("mcp_confirmations")
        .update({ status, result, used_at: now.toISOString() })
        .eq("id", id)
        .eq("status", "executing");
      if (error) throw new Error("Could not finish the operation.");
    },
    async getConfirmation(id) {
      const { data, error } = await admin.from("mcp_confirmations").select(CONFIRMATION_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error("Could not read the approval.");
      return data ? mapConfirmation(data) : null;
    },
    async decideConfirmation(id, decision) {
      const patch =
        decision.kind === "reject"
          ? { rejected_at: decision.now.toISOString(), rejected_by: decision.userId }
          : { approved_at: decision.now.toISOString(), approved_by: decision.userId };
      let query = admin
        .from("mcp_confirmations")
        .update(patch)
        .eq("id", id)
        .is("used_at", null)
        .is("rejected_at", null)
        .gt("expires_at", decision.now.toISOString());
      if (decision.kind === "approve") query = query.is("approved_at", null);
      const { data, error } = await query.select(CONFIRMATION_COLUMNS).maybeSingle();
      if (error) throw new Error("Could not record the human decision.");
      return data ? mapConfirmation(data) : null;
    },
    async saveConfirmationResult(id, result) {
      const { error } = await admin.from("mcp_confirmations").update({ result }).eq("id", id);
      if (error) throw new Error("Could not store the approval result.");
    },
    async consumeConfirmation(id, now) {
      const { data, error } = await admin
        .from("mcp_confirmations")
        .update({ used_at: now.toISOString() })
        .eq("id", id)
        .is("used_at", null)
        .select(CONFIRMATION_COLUMNS)
        .maybeSingle();
      if (error) throw new Error("Could not consume the approval.");
      return data ? mapConfirmation(data) : null;
    },
    async reserveIdempotency(tokenId, key, toolName, argsHash, now, ttlMs) {
      if (idempotencyKeyError(key)) return { kind: "invalid_key" };
      const { data: inserted, error: insertError } = await admin
        .from("mcp_idempotency_keys")
        .insert({
          token_id: tokenId,
          idempotency_key: key,
          tool_name: toolName,
          args_hash: argsHash,
          status: "running",
          response: null,
        })
        .select("tool_name, args_hash, response, created_at, status")
        .maybeSingle();
      if (!insertError && inserted) return { kind: "owned" };
      if (insertError && insertError.code !== "23505") throw new Error("Idempotency reserve failed.");
      const existing = await readIdempotency(admin, tokenId, key);
      if (!existing) throw new Error("Idempotency reserve failed.");
      const decision = decideIdempotency({
        existing,
        toolName,
        argsHash,
        now: now.getTime(),
        ttlMs,
      });
      if (decision.kind !== "owned") return decision;
      const cutoff = new Date(now.getTime() - ttlMs).toISOString();
      const { data: taken, error: takeError } = await admin
        .from("mcp_idempotency_keys")
        .update({
          tool_name: toolName,
          args_hash: argsHash,
          status: "running",
          response: null,
          created_at: now.toISOString(),
        })
        .eq("token_id", tokenId)
        .eq("idempotency_key", key)
        .in("status", ["completed", "failed"])
        .lt("created_at", cutoff)
        .select("status")
        .maybeSingle();
      if (takeError) throw new Error("Idempotency reserve failed.");
      if (!taken) {
        const again = await readIdempotency(admin, tokenId, key);
        if (!again) throw new Error("Idempotency reserve failed.");
        const next = decideIdempotency({ existing: again, toolName, argsHash, now: now.getTime(), ttlMs });
        return next.kind === "owned" ? { kind: "in_progress" } : next;
      }
      return { kind: "owned" };
    },
    async finishIdempotency(tokenId, key, status, response) {
      const { error } = await admin
        .from("mcp_idempotency_keys")
        .update({ status, response })
        .eq("token_id", tokenId)
        .eq("idempotency_key", key);
      if (error) throw new Error("Idempotency result was not saved.");
    },
  };
}

async function readIdempotency(admin: SupabaseClient, tokenId: string, key: string): Promise<IdempotencyRow | null> {
  const { data, error } = await admin
    .from("mcp_idempotency_keys")
    .select("tool_name, args_hash, response, created_at, status")
    .eq("token_id", tokenId)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error || !data) return null;
  return {
    toolName: data.tool_name as string,
    argsHash: data.args_hash as string,
    response: data.response,
    createdAt: data.created_at as string,
    status: (data.status as IdempotencyStatus) ?? "completed",
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
    approvedAt: (data.approved_at as string | null) ?? null,
    approvedBy: (data.approved_by as string | null) ?? null,
    rejectedAt: (data.rejected_at as string | null) ?? null,
    rejectedBy: (data.rejected_by as string | null) ?? null,
    result: data.result ?? null,
    status: (data.status as ConfirmationRow["status"]) ?? "pending",
    idempotencyKey: (data.idempotency_key as string | null) ?? null,
  };
}
