import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateServiceToken } from "./mcp/crypto.ts";
import {
  executeHumanApproved,
  handleMcp,
  toolText,
  CONFIRM_TTL_MS,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  negotiateProtocolVersion,
  isInvalidMcpProtocolVersionHeader,
} from "./mcp/protocol.ts";
import { memoryStore } from "./mcp/store.ts";
import type { LiveTool } from "./mcp/protocol.ts";
import type { ServiceTokenRow } from "./mcp/auth.ts";

const SECRET = "super-secret-service-role-value";

function issued(scopes: string[], extra: Partial<ServiceTokenRow> = {}) {
  const minted = generateServiceToken();
  const row: ServiceTokenRow = {
    id: extra.id ?? "tok_1",
    name: extra.name ?? "Grok Bot",
    scopes,
    expires_at: extra.expires_at ?? null,
    revoked_at: extra.revoked_at ?? null,
    overlap_until: extra.overlap_until ?? null,
    token_hash: minted.hash,
  };
  return { raw: minted.raw, row };
}

function callTool(name: string, args: Record<string, unknown>, id = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

const readTool: LiveTool = {
  name: "events_list",
  description: "List events",
  scopes: ["read.events"],
  confirm: false,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  async execute() {
    return { events: [] };
  },
};

describe("mcp protocol", () => {
  it("rejects a missing, invalid, revoked, expired, and overlap-ended token", async () => {
    const { store, addToken } = memoryStore();
    const revoked = issued(["read.events"], { id: "rev", revoked_at: "2026-01-01T00:00:00Z" });
    const expired = issued(["read.events"], { id: "exp", expires_at: "2020-01-01T00:00:00Z" });
    const overlapped = issued(["read.events"], { id: "ov", overlap_until: "2020-01-01T00:00:00Z" });
    addToken(revoked.row);
    addToken(expired.row);
    addToken(overlapped.row);
    const now = new Date("2026-11-08T00:00:00Z");
    const body = { jsonrpc: "2.0", id: 1, method: "ping" };

    const missing = await handleMcp(store, [], { body, authorization: null, now });
    assert.equal(missing.status, 401);
    assert.match(JSON.stringify(missing.body), /Missing bearer token/);

    const invalid = await handleMcp(store, [], { body, authorization: "Bearer xos_mcp_not-a-real-token", now });
    assert.equal(invalid.status, 401);
    assert.match(JSON.stringify(invalid.body), /Invalid bearer token/);

    const rev = await handleMcp(store, [], { body, authorization: `Bearer ${revoked.raw}`, now });
    assert.match(JSON.stringify(rev.body), /revoked/);

    const exp = await handleMcp(store, [], { body, authorization: `Bearer ${expired.raw}`, now });
    assert.match(JSON.stringify(exp.body), /expired/);

    const ov = await handleMcp(store, [], { body, authorization: `Bearer ${overlapped.raw}`, now });
    assert.match(JSON.stringify(ov.body), /overlap/);

    const throwing = {
      ...store,
      async hitRateLimit() {
        throw new Error("missing");
      },
    };
    const closed = await handleMcp(throwing, [], { body, authorization: null, ip: "203.0.113.5", now });
    assert.equal(closed.status, 429);

    const audits = await store.audits();
    assert.equal(audits.length, 6);
    assert.ok(audits.every((row) => !JSON.stringify(row).includes(revoked.raw)));
    assert.ok(audits.every((row) => row.argsRedacted == null || !JSON.stringify(row.argsRedacted).includes("xos_mcp_")));
  });

  it("enforces scopes and lists only allowed tools", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["read.events"]);
    addToken(row);
    const writeTool: LiveTool = {
      name: "events_delete",
      description: "Delete an event",
      scopes: ["delete"],
      confirm: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["event_id"],
        properties: { event_id: { type: "string" } },
      },
      async execute() {
        return { deleted: true };
      },
    };
    const denied = await handleMcp(store, [readTool, writeTool], {
      body: callTool("events_delete", { event_id: "abc" }),
      authorization: `Bearer ${raw}`,
    });
    assert.equal(denied.status, 200);
    assert.match(JSON.stringify(denied.body), /Missing scope: delete/);

    const listed = await handleMcp(store, [readTool, writeTool], {
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      authorization: `Bearer ${raw}`,
    });
    const names = ((listed.body as { result: { tools: { name: string }[] } }).result.tools).map((tool) => tool.name);
    assert.ok(names.includes("events_list"));
    assert.ok(names.includes("xos_whoami"));
    assert.equal(names.includes("events_delete"), false);

    const who = await handleMcp(store, [readTool, writeTool], {
      body: callTool("xos_whoami", {}),
      authorization: `Bearer ${raw}`,
    });
    const info = toolText((who.body as { result: unknown }).result) as { tools: { name: string }[] };
    assert.equal(info.tools.some((tool) => tool.name === "events_delete"), false);
    assert.equal(info.tools.some((tool) => tool.name === "events_list"), true);
  });

  it("requires a preview before a risky tool runs, and rejects replay, tampering, and expiry", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["money"], { id: "money-token" });
    const other = issued(["money"], { id: "other-token" });
    addToken(row);
    addToken(other.row);
    let ran: unknown[] = [];
    const pay: LiveTool = {
      name: "payments_add",
      description: "Record a payment",
      scopes: ["money"],
      confirm: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["event_id", "amount"],
        properties: { event_id: { type: "string" }, amount: { type: "number", minimum: 0.01 } },
      },
      async preview(args) {
        return { will_record: args.amount };
      },
      async execute(args) {
        ran.push(args);
        return { recorded: args.amount };
      },
    };
    const now = new Date("2026-11-08T12:00:00Z");
    const preview = await handleMcp(store, [pay], {
      body: callTool("payments_add", { event_id: "evt", amount: 125, idempotency_key: "preview-key-1" }),
      authorization: `Bearer ${raw}`,
      now,
      secrets: [SECRET],
    });
    assert.equal(ran.length, 0);
    const previewBody = toolText((preview.body as { result: unknown }).result) as {
      status: string;
      confirmation_id: string;
      executed: boolean;
    };
    assert.equal(previewBody.status, "pending_human");
    assert.equal(previewBody.executed, false);
    const id = previewBody.confirmation_id;

    const tamper = await handleMcp(store, [pay], {
      body: callTool("xos_confirm", { confirmation_id: id, amount: 1 }),
      authorization: `Bearer ${raw}`,
      now,
    });
    assert.match(JSON.stringify(tamper.body), /not allowed/);
    assert.equal(ran.length, 0);

    const stranger = await handleMcp(store, [pay], {
      body: callTool("xos_confirm", { confirmation_id: id }),
      authorization: `Bearer ${other.raw}`,
      now,
    });
    assert.match(JSON.stringify(stranger.body), /not found/);
    assert.equal(ran.length, 0);

    const agentConfirm = await handleMcp(store, [pay], {
      body: callTool("xos_confirm", { confirmation_id: id }),
      authorization: `Bearer ${raw}`,
      now,
    });
    const agentBody = toolText((agentConfirm.body as { result: unknown }).result) as { executed: boolean; approved: boolean };
    assert.equal(agentBody.executed, false);
    assert.equal(agentBody.approved, false);
    assert.equal(ran.length, 0);

    const approved = await executeHumanApproved(store, [pay], {
      confirmationId: id,
      userId: "11111111-1111-4111-8111-111111111111",
      token: { id: row.id, name: row.name, scopes: row.scopes, revoked_at: null, expires_at: null, overlap_until: null },
      now,
      admin: {} as never,
      secrets: [SECRET],
    });
    assert.deepEqual(ran, [{ event_id: "evt", amount: 125 }]);
    assert.equal((approved.body as { structuredContent: { recorded: number } }).structuredContent.recorded, 125);

    await assert.rejects(
      () => executeHumanApproved(store, [pay], {
        confirmationId: id,
        userId: "11111111-1111-4111-8111-111111111111",
        token: { id: row.id, name: row.name, scopes: row.scopes, revoked_at: null, expires_at: null, overlap_until: null },
        now,
        admin: {} as never,
        secrets: [],
      }),
      /already performed/,
    );
    assert.equal(ran.length, 1);

    const second = await handleMcp(store, [pay], {
      body: callTool("payments_add", { event_id: "evt", amount: 10, idempotency_key: "preview-key-2" }),
      authorization: `Bearer ${raw}`,
      now,
    });
    const secondId = (toolText((second.body as { result: unknown }).result) as { confirmation_id: string }).confirmation_id;
    const late = await handleMcp(store, [pay], {
      body: callTool("xos_confirm", { confirmation_id: secondId }),
      authorization: `Bearer ${raw}`,
      now: new Date(now.getTime() + CONFIRM_TTL_MS + 1000),
    });
    assert.match(JSON.stringify(late.body), /expired/);
    assert.equal(ran.length, 1);
  });

  it("writes an audit row and redacts secrets from results", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["read.events"]);
    addToken(row);
    const leak: LiveTool = {
      name: "events_list",
      description: "List events",
      scopes: ["read.events"],
      confirm: false,
      inputSchema: { type: "object", additionalProperties: false, properties: { note: { type: "string" } } },
      async execute() {
        return { service_role: SECRET, nested: { api_key: "abc", note: `prefix ${SECRET} suffix` } };
      },
    };
    const res = await handleMcp(store, [leak], {
      body: callTool("events_list", { note: `see ${SECRET}` }),
      authorization: `Bearer ${raw}`,
      secrets: [SECRET],
    });
    const text = JSON.stringify(res.body);
    assert.equal(text.includes(SECRET), false);
    const audits = await store.audits();
    const call = audits.find((item) => item.toolName === "events_list");
    assert.ok(call);
    assert.equal(JSON.stringify(call).includes(SECRET), false);
    assert.equal(call?.status, "ok");
    assert.equal(typeof call?.durationMs, "number");
  });

  it("rate limits a token and replays idempotent writes", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["write.events"]);
    addToken(row);
    let runs = 0;
    const note: LiveTool = {
      name: "events_add_note",
      description: "Add a note",
      scopes: ["write.events"],
      confirm: false,
      writes: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["event_id", "body"],
        properties: { event_id: { type: "string" }, body: { type: "string" } },
      },
      async execute() {
        runs += 1;
        return { ok: true, n: runs };
      },
    };
    const args = { event_id: "evt", body: "hello", idempotency_key: "note-9-ok-key" };
    const first = await handleMcp(store, [note], {
      body: callTool("events_add_note", args),
      authorization: `Bearer ${raw}`,
      limits: { perToken: 10, perExecute: 10 },
    });
    const second = await handleMcp(store, [note], {
      body: callTool("events_add_note", args),
      authorization: `Bearer ${raw}`,
      limits: { perToken: 10, perExecute: 10 },
    });
    assert.equal(runs, 1);
    assert.equal((toolText((first.body as { result: unknown }).result) as { n: number }).n, 1);
    assert.equal((toolText((second.body as { result: unknown }).result) as { n: number }).n, 1);

    const { store: limited, addToken: addLimited } = memoryStore();
    const again = issued(["read.events"], { id: "limited" });
    addLimited(again.row);
    const limits = { perToken: 2, perExecute: 10, windowMs: 60_000 };
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    assert.equal((await handleMcp(limited, [], { body: ping, authorization: `Bearer ${again.raw}`, limits })).status, 200);
    assert.equal((await handleMcp(limited, [], { body: ping, authorization: `Bearer ${again.raw}`, limits })).status, 200);
    const blocked = await handleMcp(limited, [], { body: ping, authorization: `Bearer ${again.raw}`, limits });
    assert.equal(blocked.status, 429);
  });

  it("does not run a write twice when two calls share an idempotency key", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["write.events"], { id: "idem-token" });
    addToken(row);
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const note: LiveTool = {
      name: "events_add_note",
      description: "Add a note that must not double",
      scopes: ["write.events"],
      confirm: false,
      writes: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["event_id"],
        properties: { event_id: { type: "string" } },
      },
      async execute() {
        started += 1;
        await gate;
        return { ok: true };
      },
    };
    const key = "same-key-1234";
    const first = handleMcp(store, [note], {
      body: callTool("events_add_note", { event_id: "evt", idempotency_key: key }),
      authorization: `Bearer ${raw}`,
    });
    const second = handleMcp(store, [note], {
      body: callTool("events_add_note", { event_id: "evt", idempotency_key: key }),
      authorization: `Bearer ${raw}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(started, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409]);
  });

  it("reuses one preview for the same idempotency key and refuses an expired token at approval", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["money"], { id: "op-token" });
    addToken(row);
    let freezes = 0;
    const pay: LiveTool = {
      name: "payments_add",
      description: "Record a payment once",
      scopes: ["money"],
      confirm: true,
      inputSchema: { type: "object", additionalProperties: false, properties: { amount: { type: "number" } } },
      async freeze() {
        freezes += 1;
        return { amount: 10, rendered: "record 10" };
      },
      async execute() {
        return { ok: true };
      },
    };
    const args = { amount: 10, idempotency_key: "same-preview-1" };
    const first = await handleMcp(store, [pay], { body: callTool("payments_add", args), authorization: `Bearer ${raw}` });
    const second = await handleMcp(store, [pay], { body: callTool("payments_add", args), authorization: `Bearer ${raw}` });
    const a = toolText((first.body as { result: unknown }).result) as { confirmation_id: string };
    const b = toolText((second.body as { result: unknown }).result) as { confirmation_id: string };
    assert.equal(a.confirmation_id, b.confirmation_id);
    assert.equal(freezes, 1);
    await assert.rejects(
      () => executeHumanApproved(store, [pay], {
        confirmationId: a.confirmation_id,
        userId: "11111111-1111-4111-8111-111111111111",
        token: { ...row, scopes: row.scopes, expires_at: "2000-01-01T00:00:00Z" },
        now: new Date(),
        admin: {} as never,
        secrets: [],
      }),
      /not active \(expired\)/,
    );
  });

  it("publishes idempotency_key on every tool schema", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["read.events"]);
    addToken(row);
    const listed = await handleMcp(store, [readTool], {
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      authorization: `Bearer ${raw}`,
    });
    const tools = (listed.body as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } }).result.tools;
    const events = tools.find((tool) => tool.name === "events_list");
    assert.ok(events?.inputSchema.properties.idempotency_key);
  });

  it("stops a second human approval when the write limit is already used", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["money"], { id: "limit-approve" });
    addToken(row);
    const pay: LiveTool = {
      name: "payments_add",
      description: "Record a payment under a limit",
      scopes: ["money"],
      confirm: true,
      inputSchema: { type: "object", additionalProperties: false, properties: { amount: { type: "number" } } },
      async execute() {
        return { ok: true };
      },
    };
    const first = await handleMcp(store, [pay], {
      body: callTool("payments_add", { amount: 1, idempotency_key: "limit-preview-1" }),
      authorization: `Bearer ${raw}`,
    });
    const id = (toolText((first.body as { result: unknown }).result) as { confirmation_id: string }).confirmation_id;
    const blocking = { ...store, async hitRateLimit() { return true; } };
    await assert.rejects(
      () => executeHumanApproved(blocking, [pay], {
        confirmationId: id,
        userId: "11111111-1111-4111-8111-111111111111",
        token: { ...row, scopes: row.scopes },
        now: new Date(),
        admin: {} as never,
        secrets: [],
      }),
      /Rate limit exceeded/,
    );
  });

  it("marks the operation uncertain when the final audit cannot be stored", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["money"], { id: "audit-approve" });
    addToken(row);
    const flaky = {
      ...store,
      async insertAudit(entry: Parameters<typeof store.insertAudit>[0]) {
        if (entry.status === "completed" || entry.status === "failed") throw new Error("audit down");
        return store.insertAudit(entry);
      },
    };
    const pay: LiveTool = {
      name: "payments_add",
      description: "Record a payment with a durable audit",
      scopes: ["money"],
      confirm: true,
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      async execute() {
        return { ok: true };
      },
    };
    const preview = await handleMcp(flaky, [pay], {
      body: callTool("payments_add", { idempotency_key: "audit-preview-1" }),
      authorization: `Bearer ${raw}`,
    });
    const id = (toolText((preview.body as { result: unknown }).result) as { confirmation_id: string }).confirmation_id;
    await assert.rejects(
      () => executeHumanApproved(flaky, [pay], {
        confirmationId: id,
        userId: "11111111-1111-4111-8111-111111111111",
        token: { ...row, scopes: row.scopes },
        now: new Date(),
        admin: {} as never,
        secrets: [],
      }),
      /audit/i,
    );
    const saved = await store.getConfirmation(id);
    assert.equal(saved?.status, "uncertain");
  });

  it("negotiates initialize protocol versions without a version-mismatch error", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued([]);
    addToken(row);
    const supported = new Set<string>(MCP_SUPPORTED_PROTOCOL_VERSIONS);

    const cases: Array<{ requested: string; expected: string }> = [
      { requested: "2025-11-25", expected: MCP_PROTOCOL_VERSION },
      { requested: "2025-06-18", expected: "2025-06-18" },
      { requested: "2025-03-26", expected: "2025-03-26" },
      { requested: "2024-11-05", expected: MCP_PROTOCOL_VERSION },
      { requested: "not-a-real-version", expected: MCP_PROTOCOL_VERSION },
    ];

    for (const item of cases) {
      assert.equal(negotiateProtocolVersion(item.requested), item.expected);
      const res = await handleMcp(store, [], {
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: item.requested, capabilities: {}, clientInfo: { name: "test", version: "0" } },
        },
        authorization: `Bearer ${raw}`,
      });
      assert.equal(res.status, 200, item.requested);
      const body = res.body as { result?: { protocolVersion?: string }; error?: unknown };
      assert.equal(body.error, undefined, item.requested);
      assert.ok(body.result, item.requested);
      assert.equal(body.result.protocolVersion, item.expected, item.requested);
      assert.ok(supported.has(body.result.protocolVersion!), item.requested);
    }

    const unauth = await handleMcp(store, [], {
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0" } },
      },
      authorization: null,
    });
    assert.equal(unauth.status, 401);
    assert.match(JSON.stringify(unauth.body), /Missing bearer token/);

    assert.equal(isInvalidMcpProtocolVersionHeader("2025-06-18"), false);
    assert.equal(isInvalidMcpProtocolVersionHeader("2025-11-25"), false);
    assert.equal(isInvalidMcpProtocolVersionHeader("2025-03-26"), false);
    assert.equal(isInvalidMcpProtocolVersionHeader("not-a-date"), true);
    assert.equal(isInvalidMcpProtocolVersionHeader("1.0"), true);
  });
});
