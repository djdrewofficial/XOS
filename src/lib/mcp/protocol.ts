import { canonicalJson, hashToken, hashesEqual, sha256 } from "./crypto";
import { auditView, hideClientLinks, redact } from "./redact";
import { tokenDecision, type ServiceTokenRow } from "./auth";
import { idempotencyKeyError } from "./idempotency";
import { missingScopes, scopesAllow } from "./scopes";
import type { McpStore } from "./store";
import { McpAuthError, McpScopeError, type ToolContext, type ToolHandler, type ToolSpec } from "./types";
import { validateArgs } from "./validate";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const CONFIRM_TTL_MS = 10 * 60 * 1000;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_LIMITS = {
  windowMs: 60_000,
  perToken: 120,
  perExecute: 20,
  authFailsPerIp: 30,
};

export type McpLimits = typeof DEFAULT_LIMITS;

export type LiveTool = ToolSpec & ToolHandler;

export type McpCall = {
  body: unknown;
  authorization: string | null;
  now?: Date;
  ip?: string | null;
  secrets?: readonly string[];
  requestId?: string | null;
  idempotencyKey?: string | null;
  admin?: SupabaseClient | null;
  limits?: Partial<McpLimits>;
};

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };

const WHOAMI: LiveTool = {
  name: "xos_whoami",
  description:
    "Discovery. Returns this service token's name, scopes, expiry, and the tools it is allowed to call. Does not change anything.",
  scopes: [],
  confirm: false,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  async execute(_args, ctx) {
    return {
      name: ctx.token.name,
      scopes: ctx.token.scopes,
      tools: [],
    };
  },
};

const CONFIRM: LiveTool = {
  name: "xos_confirm",
  description:
    "Read the status of a preview. This does not approve the action and does not run it. A signed-in person approves the exact receipt in XOS. A chat draft card is still required before a host asks for that approval.",
  scopes: [],
  confirm: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["confirmation_id"],
    properties: {
      confirmation_id: { type: "string", minLength: 4, maxLength: 80, description: "The id returned by the preview call." },
    },
  },
  async execute() {
    throw new Error("xos_confirm is handled by the server");
  },
};

export async function handleMcp(store: McpStore, tools: readonly LiveTool[], call: McpCall): Promise<{ status: number; body: unknown }> {
  const now = call.now ?? new Date();
  const secrets = call.secrets ?? [];
  const limits = { ...DEFAULT_LIMITS, ...call.limits };
  const started = Date.now();
  const requestId = call.requestId ?? null;
  const catalog = [WHOAMI, CONFIRM, ...tools.filter((tool) => tool.name !== "xos_whoami" && tool.name !== "xos_confirm")];

  let tokenId: string | null = null;
  let tokenName: string | null = null;
  let toolName: string | null = null;
  let argsRedacted: unknown = null;
  let confirmationId: string | null = null;
  let idempotencyKey: string | null = null;

  const finish = async (status: number, body: unknown, audit: { status: string; errorCode?: string | null }) => {
    try {
      await store.insertAudit({
        tokenId,
        tokenName,
        toolName,
        argsRedacted,
        status: audit.status,
        errorCode: audit.errorCode ?? null,
        durationMs: Math.max(0, Date.now() - started),
        confirmationId,
        idempotencyKey,
        requestId,
      });
    } catch {
      // Auth failures still return their own status when the audit table is not there yet.
      // Harmful writes already stop in beginAudit before any effect.
    }
    return { status, body: hideClientLinks(body) };
  };

  const raw = bearer(call.authorization);
  if (!raw) {
    if (call.ip && (await limited(store, "mcp:authfail", call.ip, limits.authFailsPerIp, limits.windowMs, now))) {
      return finish(429, rpcError(null, -32029, "Too many authentication attempts"), { status: "rate_limited", errorCode: "rate_limited" });
    }
    return finish(401, rpcError(null, -32001, "Missing bearer token"), { status: "unauthorized", errorCode: "missing" });
  }

  const token = await store.findTokenByHash(hashToken(raw));
  if (!token || !hashesEqual(token.token_hash, hashToken(raw))) {
    if (call.ip && (await limited(store, "mcp:authfail", call.ip, limits.authFailsPerIp, limits.windowMs, now))) {
      return finish(429, rpcError(null, -32029, "Too many authentication attempts"), { status: "rate_limited", errorCode: "rate_limited" });
    }
    return finish(401, rpcError(null, -32001, "Invalid bearer token"), { status: "unauthorized", errorCode: "invalid" });
  }
  tokenId = token.id;
  tokenName = token.name;
  const decision = tokenDecision(token, now);
  if (!decision.ok) {
    const message =
      decision.reason === "revoked"
        ? "Token revoked"
        : decision.reason === "expired"
          ? "Token expired"
          : "Token rotation overlap has ended";
    return finish(401, rpcError(null, -32001, message), { status: "unauthorized", errorCode: decision.reason });
  }
  await store.touchToken(token.id, now);

  if (await limited(store, "mcp:token", token.id, limits.perToken, limits.windowMs, now)) {
    return finish(429, rpcError(null, -32029, "Rate limit exceeded"), { status: "rate_limited", errorCode: "rate_limited" });
  }

  if (!call.body || typeof call.body !== "object" || Array.isArray(call.body)) {
    return finish(400, rpcError(null, -32600, "Invalid request"), { status: "error", errorCode: "invalid_request" });
  }
  const rpc = call.body as Rpc;
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return finish(400, rpcError(rpc.id ?? null, -32600, "Invalid request"), { status: "error", errorCode: "invalid_request" });
  }
  toolName = rpc.method;
  const isNotification = rpc.id === undefined || rpc.method.startsWith("notifications/");
  if (isNotification) {
    return finish(202, null, { status: "ok" });
  }

  const ctx: ToolContext = {
    now,
    token: { id: token.id, name: token.name, scopes: token.scopes },
    admin: (call.admin ?? null) as SupabaseClient,
  };

  if (rpc.method === "initialize") {
    const requested = (rpc.params as { protocolVersion?: string } | undefined)?.protocolVersion;
    if (requested && requested !== "2025-03-26" && requested !== MCP_PROTOCOL_VERSION) {
      return finish(200, rpcError(rpc.id, -32602, `Unsupported protocol version ${requested}`), { status: "error", errorCode: "protocol" });
    }
    return finish(200, rpcOk(rpc.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "xos-mcp", version: "1.0.0" },
      instructions:
        "XOS service connector. Risky tools return a preview and a confirmation_id. xos_confirm only reports status. A signed-in master admin approves the receipt in XOS before anything is sent or changed. Call xos_whoami to see what this token can do.",
    }), { status: "ok" });
  }

  if (rpc.method === "ping") {
    return finish(200, rpcOk(rpc.id, {}), { status: "ok" });
  }

  if (rpc.method === "tools/list") {
    const visible = catalog.filter((tool) => scopesAllow(token.scopes, tool.scopes));
    return finish(200, rpcOk(rpc.id, {
      tools: visible.map(publicTool),
    }), { status: "ok" });
  }

  if (rpc.method !== "tools/call") {
    return finish(200, rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`), { status: "error", errorCode: "method" });
  }

  const params = (rpc.params ?? {}) as { name?: unknown; arguments?: unknown };
  if (typeof params.name !== "string") {
    return finish(200, rpcError(rpc.id, -32602, "tools/call requires a tool name"), { status: "error", errorCode: "invalid_params" });
  }
  toolName = params.name;
  const tool = catalog.find((item) => item.name === params.name);
  if (!tool || !scopesAllow(token.scopes, tool.scopes)) {
    const code = tool ? "forbidden" : "unknown_tool";
    const message = tool ? `Missing scope: ${missingScopes(token.scopes, tool.scopes).join(", ")}` : `Unknown tool: ${params.name}`;
    return finish(200, rpcError(rpc.id, tool ? -32003 : -32602, message), { status: tool ? "forbidden" : "error", errorCode: code });
  }

  const rawArgs = params.arguments == null ? {} : params.arguments;
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return finish(200, rpcError(rpc.id, -32602, "Tool arguments must be an object"), { status: "error", errorCode: "invalid_params" });
  }
  const argsIn = { ...(rawArgs as Record<string, unknown>) };
  const keyFromArgs = typeof argsIn.idempotency_key === "string" ? argsIn.idempotency_key.trim() : "";
  delete argsIn.idempotency_key;
  idempotencyKey = (call.idempotencyKey ?? "").trim() || keyFromArgs || null;
  argsRedacted = auditView(argsIn, secrets);

  const invalid = validateArgs(tool.inputSchema, argsIn);
  if (invalid) {
    return finish(200, rpcError(rpc.id, -32602, invalid), { status: "error", errorCode: "invalid_params" });
  }

  if (tool.name === "xos_whoami") {
    const visible = catalog.filter((item) => item.name !== "xos_whoami" && scopesAllow(token.scopes, item.scopes));
    const payload = redact({
      name: token.name,
      scopes: token.scopes,
      expires_at: token.expires_at,
      tools: visible.map((item) => ({
        name: item.name,
        description: item.description,
        scopes: item.scopes,
        confirm: item.confirm,
      })),
    }, secrets);
    return finish(200, rpcOk(rpc.id, toolResult(payload, false)), { status: "ok" });
  }

  if (tool.name === "xos_confirm") {
    return confirm(store, catalog, {
      rpcId: rpc.id,
      confirmationId: String(argsIn.confirmation_id),
      idempotencyKey,
      ctx,
      secrets,
      now,
      limits,
      finish,
      setConfirmation: (id) => {
        confirmationId = id;
      },
    });
  }

  if (!scopesAllow(token.scopes, tool.scopes)) {
    return finish(200, rpcError(rpc.id, -32003, `Missing scope: ${missingScopes(token.scopes, tool.scopes).join(", ")}`), { status: "forbidden", errorCode: "forbidden" });
  }

  try {
    await tool.authorize?.(argsIn, ctx);
  } catch (err) {
    const scoped = err instanceof McpScopeError;
    const message = err instanceof Error ? err.message : "Not allowed";
    return finish(200, rpcError(rpc.id, scoped ? -32003 : -32000, String(redact(message, secrets))), {
      status: scoped ? "forbidden" : "error",
      errorCode: scoped ? "forbidden" : "authorize",
    });
  }

  const write = harmfulWrite(tool);
  if ((tool.confirm || write) && !idempotencyKey) {
    return finish(200, rpcError(rpc.id, -32602, "This write requires idempotency_key of 8 to 200 characters in the tool arguments."), { status: "error", errorCode: "idempotency" });
  }
  if (idempotencyKey && idempotencyKeyError(idempotencyKey)) {
    return finish(200, rpcError(rpc.id, -32602, idempotencyKeyError(idempotencyKey) ?? "Invalid idempotency key"), { status: "error", errorCode: "idempotency" });
  }

  if (tool.confirm) {
    const argsHash = sha256(canonicalJson(argsIn));
    const existing = await store.findOperation(token.id, idempotencyKey!);
    if (existing) {
      if (existing.toolName !== tool.name || existing.argsHash !== argsHash) {
        return finish(200, rpcError(rpc.id, -32009, "This idempotency_key was already used for a different operation."), { status: "error", errorCode: "idempotency" });
      }
      confirmationId = existing.id;
      return finish(200, rpcOk(rpc.id, toolResult(operationPayload(existing), false)), { status: existing.status === "pending" ? "confirmation_required" : "idempotent_replay" });
    }
    if (await limited(store, "mcp:execute", token.id, limits.perExecute, limits.windowMs, now)) {
      return finish(429, rpcError(rpc.id, -32029, "Rate limit exceeded for writes"), { status: "rate_limited", errorCode: "rate_limited" });
    }
    let snapshot: unknown = { arguments: argsIn };
    let shown: unknown = snapshot;
    try {
      if (tool.freeze) snapshot = await tool.freeze(argsIn, ctx);
      shown = tool.preview ? await tool.preview(argsIn, ctx) : snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      return finish(200, rpcError(rpc.id, -32000, String(redact(message, secrets))), { status: "error", errorCode: "preview" });
    }
    const effectHash = sha256(canonicalJson(snapshot));
    const receipt = { receipt: shown, effect_snapshot: snapshot, effect_hash: effectHash };
    const row = await store.createConfirmation({
      tokenId: token.id,
      toolName: tool.name,
      argsHash,
      args: argsIn,
      preview: receipt,
      expiresAt: new Date(now.getTime() + CONFIRM_TTL_MS).toISOString(),
      idempotencyKey,
    });
    confirmationId = row.id;
    return finish(200, rpcOk(rpc.id, toolResult(operationPayload(row), false)), { status: "confirmation_required" });
  }

  if (write && (await limited(store, "mcp:execute", token.id, limits.perExecute, limits.windowMs, now))) {
    return finish(429, rpcError(rpc.id, -32029, "Rate limit exceeded for writes"), { status: "rate_limited", errorCode: "rate_limited" });
  }

  if (write && !(await beginAudit(store, { tokenId, tokenName, toolName, argsRedacted, confirmationId, idempotencyKey, requestId }))) {
    return finish(503, rpcError(rpc.id, -32010, "Audit log unavailable. Nothing was changed."), { status: "error", errorCode: "audit" });
  }

  if (idempotencyKey && write) {
    const reserved = await store.reserveIdempotency(token.id, idempotencyKey, tool.name, sha256(canonicalJson(argsIn)), now, IDEMPOTENCY_TTL_MS);
    const blocked = idempotencyBlock(rpc.id, reserved);
    if (blocked) return finish(blocked.status, blocked.body, blocked.audit);
    if (reserved.kind === "replay") return finish(200, rpcOk(rpc.id, reserved.response), { status: "idempotent_replay" });
  }

  const outcome = await runExecute(tool, argsIn, ctx, secrets);
  if (idempotencyKey && write) {
    await store.finishIdempotency(token.id, idempotencyKey, outcome.ok ? "completed" : "failed", outcome.body);
  }
  return finish(200, rpcOk(rpc.id, outcome.body), { status: outcome.ok ? "ok" : "error", errorCode: outcome.ok ? null : "tool" });
}

async function confirm(
  store: McpStore,
  _catalog: readonly LiveTool[],
  input: {
    rpcId: unknown;
    confirmationId: string;
    idempotencyKey: string | null;
    ctx: ToolContext;
    secrets: readonly string[];
    now: Date;
    limits: McpLimits;
    finish: (status: number, body: unknown, audit: { status: string; errorCode?: string | null }) => Promise<{ status: number; body: unknown }>;
    setConfirmation: (id: string) => void;
  },
) {
  void input.idempotencyKey;
  void input.limits;
  input.setConfirmation(input.confirmationId);
  const row = await store.getConfirmation(input.confirmationId);
  if (!row || row.tokenId !== input.ctx.token.id) {
    return input.finish(200, rpcError(input.rpcId, -32004, "Confirmation not found"), { status: "error", errorCode: "confirmation_missing" });
  }
  const payload = redact({
    executed: Boolean(row.usedAt),
    approved: Boolean(row.approvedAt),
    rejected: Boolean(row.rejectedAt),
    expired: Date.parse(row.expiresAt) <= input.now.getTime(),
    tool: row.toolName,
    receipt: (row.preview as { receipt?: unknown } | null)?.receipt ?? row.preview,
    result: row.result,
    message: row.usedAt
      ? "A person already approved this in XOS and it has run. This call did not run it again."
      : "This call does not approve and does not run the action. A signed-in person has to approve the receipt in XOS.",
  }, input.secrets);
  return input.finish(200, rpcOk(input.rpcId, toolResult(payload, false)), { status: "ok" });
}

/** Runs a preview only after a signed-in person has been recorded as the approver.
    The agent bearer cannot call this. Mutable template and helper snapshots are
    checked again and the action is refused if they changed. */
export async function executeHumanApproved(
  store: McpStore,
  tools: readonly LiveTool[],
  input: {
    confirmationId: string;
    userId: string;
    token: Pick<ServiceTokenRow, "id" | "name" | "scopes" | "revoked_at" | "expires_at" | "overlap_until">;
    now: Date;
    admin: SupabaseClient;
    secrets: readonly string[];
  },
): Promise<{ ok: boolean; body: unknown }> {
  if (!input.userId) throw new Error("A signed-in person is required.");
  const row = await store.getConfirmation(input.confirmationId);
  if (!row) throw new Error("Approval not found.");
  if (row.tokenId !== input.token.id) throw new Error("Approval not found.");
  if (row.usedAt) throw new Error("This preview was already performed.");
  if (row.rejectedAt) throw new Error("This preview was rejected.");
  if (Date.parse(row.expiresAt) <= input.now.getTime()) throw new Error("This preview expired. Ask for a new one.");
  const tool = tools.find((item) => item.name === row.toolName);
  if (!tool?.confirm) throw new Error("This preview cannot be run.");
  if (sha256(canonicalJson(row.args)) !== row.argsHash) throw new Error("Stored arguments do not match the receipt.");
  const tokenState = tokenDecision(input.token, input.now);
  if (!tokenState.ok) throw new Error(`The agent token is not active (${tokenState.reason}).`);
  if (!scopesAllow(input.token.scopes, tool.scopes)) throw new Error("The token no longer has the scopes for this action.");
  if (await limited(store, "mcp:execute", input.token.id, DEFAULT_LIMITS.perExecute, DEFAULT_LIMITS.windowMs, input.now)) {
    throw new Error("Rate limit exceeded for writes. Nothing was run.");
  }
  const ctx: ToolContext = {
    now: input.now,
    token: input.token,
    admin: input.admin,
    approvedEffectHash: storedHash(row.preview),
    approvedSnapshot: (row.preview as { effect_snapshot?: unknown } | null)?.effect_snapshot,
  };
  await tool.authorize?.(row.args, ctx);
  if (row.status === "executing") throw new Error("This operation is already executing. It was not run again.");
  if (row.status === "completed" || row.status === "failed" || row.status === "uncertain") {
    throw new Error("This preview was already performed.");
  }
  const begun = await beginAudit(store, {
    tokenId: row.tokenId,
    tokenName: input.token.name,
    toolName: row.toolName,
    argsRedacted: auditView(row.args, input.secrets),
    confirmationId: row.id,
    idempotencyKey: null,
    requestId: null,
  });
  if (!begun) throw new Error("Audit log unavailable. Nothing was changed.");
  const claimed = await store.claimExecution(row.id, input.userId, input.now);
  if (!claimed) throw new Error("This preview was already performed or can no longer be approved.");
  if (tool.freeze) {
    const fresh = await tool.freeze(claimed.args, ctx);
    const stored = (claimed.preview as { effect_hash?: string } | null)?.effect_hash;
    if (!stored || sha256(canonicalJson(fresh)) !== stored) {
      await store.finishOperation(row.id, "failed", { error: "rendered effect changed" }, input.now);
      throw new Error("The rendered message changed after the preview. Nothing was run. Ask for a new preview.");
    }
  }
  const outcome = await runExecute(tool, claimed.args, ctx, input.secrets);
  try {
    await store.insertAudit({
      tokenId: row.tokenId,
      tokenName: input.token.name,
      toolName: row.toolName,
      argsRedacted: auditView(outcome.body, input.secrets),
      status: outcome.ok ? "completed" : "failed",
      errorCode: outcome.ok ? null : "tool",
      durationMs: null,
      confirmationId: row.id,
      idempotencyKey: claimed.idempotencyKey,
      requestId: null,
    });
  } catch {
    await store.finishOperation(row.id, "uncertain", outcome.body, input.now);
    throw new Error("Audit log unavailable after the effect. The result is uncertain.");
  }
  await store.finishOperation(row.id, outcome.ok ? "completed" : "failed", outcome.body, input.now);
  return outcome;
}

async function runExecute(tool: LiveTool, args: Record<string, unknown>, ctx: ToolContext, secrets: readonly string[]) {
  try {
    const value = redact(await tool.execute(args, ctx), secrets);
    return { ok: true, body: toolResult(value, false) };
  } catch (err) {
    if (err instanceof McpAuthError) throw err;
    const message = err instanceof Error ? err.message : "Tool failed";
    const safe = String(redact(message, secrets));
    return { ok: false, body: toolResult({ error: safe }, true) };
  }
}

function operationPayload(row: { status: string; approvedAt: string | null; id: string; expiresAt: string; toolName: string; preview: unknown }) {
  const preview = (row.preview ?? {}) as { receipt?: unknown; effect_hash?: string };
  return {
    status: row.status === "pending" ? "pending_human" : row.status,
    executed: row.status === "completed",
    approved: Boolean(row.approvedAt),
    confirmation_id: row.id,
    expires_at: row.expiresAt,
    tool: row.toolName,
    receipt: preview.receipt ?? null,
    effect_hash: preview.effect_hash ?? null,
    next: "A signed-in XOS master admin must approve this exact rendered effect in Settings → Agent Access. xos_confirm only reports status. It does not approve and it does not run the action.",
  };
}

function storedHash(preview: unknown): string | undefined {
  const hash = (preview as { effect_hash?: string } | null)?.effect_hash;
  return typeof hash === "string" ? hash : undefined;
}

function harmfulWrite(tool: LiveTool) {
  return tool.confirm || tool.writes === true;
}

function idempotencyBlock(id: unknown, reserved: { kind: string; response?: unknown }) {
  if (reserved.kind === "invalid_key") {
    return { status: 200, body: rpcError(id, -32602, "Idempotency key must be 8 to 200 characters with no whitespace."), audit: { status: "error", errorCode: "idempotency" } };
  }
  if (reserved.kind === "mismatch") {
    return { status: 200, body: rpcError(id, -32000, "Idempotency key was already used for a different call"), audit: { status: "error", errorCode: "idempotency" } };
  }
  if (reserved.kind === "in_progress") {
    return { status: 409, body: rpcError(id, -32011, "A call with this idempotency key is still running."), audit: { status: "error", errorCode: "idempotency" } };
  }
  if (reserved.kind === "uncertain") {
    return { status: 409, body: rpcError(id, -32012, "An earlier call with this key did not finish cleanly. Do not retry it. Check whether the effect happened, then use a new key."), audit: { status: "error", errorCode: "idempotency" } };
  }
  return null;
}

async function limited(store: McpStore, bucket: string, key: string, max: number, windowMs: number, now: Date) {
  try {
    return await store.hitRateLimit(bucket, key, max, windowMs, now);
  } catch {
    return true;
  }
}

async function beginAudit(
  store: McpStore,
  row: { tokenId: string | null; tokenName: string | null; toolName: string | null; argsRedacted: unknown; confirmationId: string | null; idempotencyKey: string | null; requestId: string | null },
) {
  try {
    await store.insertAudit({
      ...row,
      status: "begun",
      errorCode: null,
      durationMs: null,
    });
    return true;
  } catch {
    return false;
  }
}

function publicTool(tool: LiveTool) {
  const human = tool.confirm
    ? " A person must approve the exact receipt in XOS before this runs. xos_confirm does not approve it and does not run it."
    : "";
  const draft = tool.scopes.some((scope) => scope.startsWith("comms."))
    ? " A chat host must still show a draft card for a human to accept. This confirmation id is not that card."
    : "";
  return {
    name: tool.name,
    description: `${tool.description}${human}${draft}`,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...(tool.inputSchema.properties ?? {}),
        idempotency_key: {
          type: "string",
          minLength: 8,
          maxLength: 200,
          description: "Required for writes and approvals. The same key and arguments return the same operation.",
        },
      },
    },
    annotations: tool.confirm ? { destructiveHint: true, readOnlyHint: false } : undefined,
  };
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

function rpcOk(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(payload: unknown, isError: boolean) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError,
  };
}

export function toolText(result: unknown): unknown {
  if (!result || typeof result !== "object") return null;
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (structured !== undefined) return structured;
  return null;
}
