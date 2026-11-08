import { canonicalJson, hashToken, hashesEqual, sha256 } from "./crypto";
import { redact } from "./redact";
import { tokenDecision } from "./auth";
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
    "Execute a risky action that was already previewed. Pass only the confirmation_id from that preview. The id is single-use, expires in 10 minutes, and is bound to the exact arguments and token from the preview. Calling a risky tool without this step never performs it. Sending different arguments here is rejected.",
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
    return { status, body };
  };

  const raw = bearer(call.authorization);
  if (!raw) {
    if (call.ip) {
      const limited = await store.hitRateLimit("mcp:authfail", call.ip, limits.authFailsPerIp, limits.windowMs, now);
      if (limited) return finish(429, rpcError(null, -32029, "Too many authentication attempts"), { status: "rate_limited", errorCode: "rate_limited" });
    }
    return finish(401, rpcError(null, -32001, "Missing bearer token"), { status: "unauthorized", errorCode: "missing" });
  }

  const token = await store.findTokenByHash(hashToken(raw));
  if (!token || !hashesEqual(token.token_hash, hashToken(raw))) {
    if (call.ip) await store.hitRateLimit("mcp:authfail", call.ip, limits.authFailsPerIp, limits.windowMs, now);
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

  if (await store.hitRateLimit("mcp:token", token.id, limits.perToken, limits.windowMs, now)) {
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
        "XOS service connector. Risky tools (money, deletes, client email/text/contract) return a preview and a confirmation_id. Nothing is sent or changed until you call xos_confirm with that id. Call xos_whoami to see what this token can do.",
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
  argsRedacted = redact(argsIn, secrets);

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

  if (tool.confirm) {
    let preview: unknown;
    try {
      preview = tool.preview ? await tool.preview(argsIn, ctx) : { arguments: argsIn };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      return finish(200, rpcError(rpc.id, -32000, String(redact(message, secrets))), { status: "error", errorCode: "preview" });
    }
    const safePreview = redact(preview, secrets);
    const row = await store.createConfirmation({
      tokenId: token.id,
      toolName: tool.name,
      argsHash: sha256(canonicalJson(argsIn)),
      args: argsIn,
      preview: safePreview,
      expiresAt: new Date(now.getTime() + CONFIRM_TTL_MS).toISOString(),
    });
    confirmationId = row.id;
    const payload = redact({
      status: "confirmation_required",
      executed: false,
      confirmation_id: row.id,
      expires_at: row.expiresAt,
      tool: tool.name,
      preview: safePreview,
      next: "Call xos_confirm with this confirmation_id to perform the action. The id is single-use and bound to these arguments.",
    }, secrets);
    return finish(200, rpcOk(rpc.id, toolResult(payload, false)), { status: "confirmation_required" });
  }

  if (idempotencyKey) {
    const cached = await freshIdempotency(store, token.id, idempotencyKey, tool.name, sha256(canonicalJson(argsIn)), now);
    if (cached === "mismatch") {
      return finish(200, rpcError(rpc.id, -32000, "Idempotency key was already used for a different call"), { status: "error", errorCode: "idempotency" });
    }
    if (cached) return finish(200, rpcOk(rpc.id, cached), { status: "idempotent_replay" });
  }

  if (await store.hitRateLimit("mcp:execute", token.id, limits.perExecute, limits.windowMs, now)) {
    return finish(429, rpcError(rpc.id, -32029, "Rate limit exceeded for writes"), { status: "rate_limited", errorCode: "rate_limited" });
  }

  const outcome = await runExecute(tool, argsIn, ctx, secrets);
  if (idempotencyKey) {
    await store.saveIdempotency(token.id, idempotencyKey, {
      toolName: tool.name,
      argsHash: sha256(canonicalJson(argsIn)),
      response: outcome.body,
    }, now);
  }
  return finish(200, rpcOk(rpc.id, outcome.body), { status: outcome.ok ? "ok" : "error", errorCode: outcome.ok ? null : "tool" });
}

async function confirm(
  store: McpStore,
  catalog: readonly LiveTool[],
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
  input.setConfirmation(input.confirmationId);
  const row = await store.getConfirmation(input.confirmationId);
  if (!row || row.tokenId !== input.ctx.token.id) {
    return input.finish(200, rpcError(input.rpcId, -32004, "Confirmation not found"), { status: "error", errorCode: "confirmation_missing" });
  }
  const tool = catalog.find((item) => item.name === row.toolName);
  if (!tool || !tool.confirm) {
    return input.finish(200, rpcError(input.rpcId, -32004, "Confirmation does not match a runnable tool"), { status: "error", errorCode: "confirmation_tool" });
  }
  if (!scopesAllow(input.ctx.token.scopes, tool.scopes)) {
    return input.finish(200, rpcError(input.rpcId, -32003, `Missing scope: ${missingScopes(input.ctx.token.scopes, tool.scopes).join(", ")}`), {
      status: "forbidden",
      errorCode: "forbidden",
    });
  }
  try {
    await tool.authorize?.(row.args, input.ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Not allowed";
    return input.finish(200, rpcError(input.rpcId, err instanceof McpScopeError ? -32003 : -32000, String(redact(message, input.secrets))), {
      status: err instanceof McpScopeError ? "forbidden" : "error",
      errorCode: "authorize",
    });
  }
  const argsHash = sha256(canonicalJson(row.args));
  if (argsHash !== row.argsHash) {
    return input.finish(200, rpcError(input.rpcId, -32004, "Confirmation arguments were tampered with"), { status: "error", errorCode: "confirmation_tamper" });
  }
  if (input.idempotencyKey) {
    const cached = await freshIdempotency(store, input.ctx.token.id, input.idempotencyKey, tool.name, argsHash, input.now);
    if (cached === "mismatch") {
      return input.finish(200, rpcError(input.rpcId, -32000, "Idempotency key was already used for a different call"), { status: "error", errorCode: "idempotency" });
    }
    if (cached) return input.finish(200, rpcOk(input.rpcId, cached), { status: "idempotent_replay" });
  }
  if (row.usedAt) {
    return input.finish(200, rpcError(input.rpcId, -32004, "Confirmation already used"), { status: "error", errorCode: "confirmation_replay" });
  }
  if (Date.parse(row.expiresAt) <= input.now.getTime()) {
    return input.finish(200, rpcError(input.rpcId, -32004, "Confirmation expired"), { status: "error", errorCode: "confirmation_expired" });
  }
  if (await store.hitRateLimit("mcp:execute", input.ctx.token.id, input.limits.perExecute, input.limits.windowMs, input.now)) {
    return input.finish(429, rpcError(input.rpcId, -32029, "Rate limit exceeded for writes"), { status: "rate_limited", errorCode: "rate_limited" });
  }
  const consumed = await store.consumeConfirmation(row.id, input.now);
  if (!consumed) {
    return input.finish(200, rpcError(input.rpcId, -32004, "Confirmation already used"), { status: "error", errorCode: "confirmation_replay" });
  }
  const outcome = await runExecute(tool, consumed.args, input.ctx, input.secrets);
  if (input.idempotencyKey) {
    await store.saveIdempotency(input.ctx.token.id, input.idempotencyKey, {
      toolName: tool.name,
      argsHash,
      response: outcome.body,
    }, input.now);
  }
  return input.finish(200, rpcOk(input.rpcId, outcome.body), { status: outcome.ok ? "ok" : "error", errorCode: outcome.ok ? null : "tool" });
}

async function freshIdempotency(store: McpStore, tokenId: string, key: string, toolName: string, argsHash: string, now: Date) {
  const row = await store.getIdempotency(tokenId, key);
  if (!row) return null;
  if (now.getTime() - Date.parse(row.createdAt) > IDEMPOTENCY_TTL_MS) return null;
  if (row.toolName !== toolName || row.argsHash !== argsHash) return "mismatch" as const;
  return row.response;
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

function publicTool(tool: LiveTool) {
  return {
    name: tool.name,
    description: tool.confirm
      ? `${tool.description} Requires confirmation: the first call returns a preview and confirmation_id and does not perform the action.`
      : tool.description,
    inputSchema: tool.inputSchema,
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
