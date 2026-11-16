import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALWAYS_HUMAN_APPROVAL_TOOLS,
  skipsXosApproval,
  toolAlwaysNeedsHumanApproval,
  type ServiceTokenRow,
} from "./mcp/auth.ts";
import { generateServiceToken } from "./mcp/crypto.ts";
import { handleMcp, toolText, type LiveTool } from "./mcp/protocol.ts";
import { memoryStore } from "./mcp/store.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function issued(scopes: string[], extra: Partial<ServiceTokenRow> = {}) {
  const minted = generateServiceToken();
  const row: ServiceTokenRow = {
    id: extra.id ?? "tok_trust",
    name: extra.name ?? "Goose",
    scopes,
    expires_at: extra.expires_at ?? null,
    revoked_at: extra.revoked_at ?? null,
    overlap_until: extra.overlap_until ?? null,
    token_hash: minted.hash,
    helpers_skip_xos_approval: extra.helpers_skip_xos_approval,
    auto_approve: extra.auto_approve,
  };
  return { raw: minted.raw, row };
}

function callTool(name: string, args: Record<string, unknown>, id = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

const paymentTool: LiveTool = {
  name: "payments_add",
  description: "Record a payment",
  scopes: ["money"],
  confirm: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["event_id", "amount"],
    properties: {
      event_id: { type: "string", format: "uuid" },
      amount: { type: "number" },
    },
  },
  async preview(args) {
    return { effects: [{ kind: "payment", amount: args.amount }], event_id: args.event_id };
  },
  async execute(args, ctx) {
    return {
      ok: true,
      amount: args.amount,
      auto_approve: ctx.token.autoApprove === true,
    };
  },
};

const anonymizeTool: LiveTool = {
  name: "clients_anonymize",
  description: "Permanently anonymize a client",
  scopes: ["delete"],
  confirm: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["client_id"],
    properties: {
      client_id: { type: "string", format: "uuid" },
    },
  },
  async preview() {
    return { irreversible: true };
  },
  async execute() {
    return { ok: true };
  },
};

const EVENT = "32e79b00-bfa5-4cc1-ae4d-488b0a2fab87";
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("trusted agent auto_approve", () => {
  it("skips confirm for trusted tokens except irreversible tools", () => {
    assert.equal(
      skipsXosApproval({ name: "payments_add", confirm: true, scopes: ["money"] }, { auto_approve: true }),
      true,
    );
    assert.equal(
      skipsXosApproval({ name: "payments_add", confirm: true, scopes: ["money"] }, { auto_approve: false }),
      false,
    );
    assert.equal(
      skipsXosApproval({ name: "payments_add", confirm: true, scopes: ["money"] }, {}),
      false,
    );
    assert.equal(
      skipsXosApproval(
        { name: "clients_anonymize", confirm: true, scopes: ["delete"] },
        { auto_approve: true },
      ),
      false,
    );
    assert.equal(
      skipsXosApproval({ name: "events_delete", confirm: true, scopes: ["delete"] }, { auto_approve: true }),
      false,
    );
    assert.equal(
      skipsXosApproval(
        { name: "helpers_run", confirm: true, scopes: ["helpers.run"] },
        { helpers_skip_xos_approval: true, auto_approve: false },
      ),
      true,
    );
    for (const name of ALWAYS_HUMAN_APPROVAL_TOOLS) {
      assert.equal(toolAlwaysNeedsHumanApproval({ name }), true, name);
      assert.equal(skipsXosApproval({ name, confirm: true }, { auto_approve: true }), false, name);
    }
  });

  it("holds gated tools with pending_human when the token is not trusted", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["money"], { auto_approve: false });
    addToken(row);
    let ran = 0;
    const tool: LiveTool = {
      ...paymentTool,
      async execute() {
        ran += 1;
        return { ok: true };
      },
    };
    const res = await handleMcp(store, [tool], {
      body: callTool("payments_add", { event_id: EVENT, amount: 100, idempotency_key: "pay-hold-01" }),
      authorization: `Bearer ${raw}`,
      now: new Date("2026-11-10T12:00:00Z"),
    });
    assert.equal(ran, 0);
    const body = toolText((res.body as { result: unknown }).result) as {
      status: string;
      confirmation_id: string;
      executed: boolean;
    };
    assert.equal(body.status, "pending_human");
    assert.equal(body.executed, false);
    assert.ok(body.confirmation_id);
    const audits = await store.audits();
    assert.equal(audits.at(-1)?.status, "confirmation_required");
  });

  it("runs gated tools immediately and audits when the token is trusted", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["money"], {
      id: "tok_goose",
      name: "Goose",
      auto_approve: true,
    });
    addToken(row);
    const res = await handleMcp(store, [paymentTool], {
      body: callTool("payments_add", { event_id: EVENT, amount: 250, idempotency_key: "pay-direct-01" }),
      authorization: `Bearer ${raw}`,
      now: new Date("2026-11-10T12:00:00Z"),
    });
    const payload = toolText((res.body as { result: unknown }).result) as {
      ok: boolean;
      amount: number;
      auto_approve: boolean;
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.amount, 250);
    assert.equal(payload.auto_approve, true);

    const audits = await store.audits();
    const audit = audits.at(-1)!;
    assert.equal(audit.status, "ok");
    assert.equal(audit.toolName, "payments_add");
    assert.equal(audit.tokenId, "tok_goose");
    assert.equal(audit.tokenName, "Goose");
    assert.equal(audit.confirmationId, null);
    const args = audit.argsRedacted as {
      event_id: string;
      amount: number;
      auto_approve: boolean;
      receipt: { effects: unknown[] };
    };
    assert.equal(args.event_id, EVENT);
    assert.equal(args.amount, 250);
    assert.equal(args.auto_approve, true);
    assert.ok(Array.isArray(args.receipt.effects));
    assert.match(JSON.stringify(audit), /payment|250|effects/);
  });

  it("still holds irreversible tools for a trusted token", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["delete"], {
      id: "tok_irrev",
      auto_approve: true,
    });
    addToken(row);
    let ran = 0;
    const tool: LiveTool = {
      ...anonymizeTool,
      async execute() {
        ran += 1;
        return { ok: true };
      },
    };
    const res = await handleMcp(store, [tool], {
      body: callTool("clients_anonymize", { client_id: CLIENT, idempotency_key: "anon-still-01" }),
      authorization: `Bearer ${raw}`,
      now: new Date("2026-11-10T12:00:00Z"),
    });
    assert.equal(ran, 0);
    const body = toolText((res.body as { result: unknown }).result) as { status: string; executed: boolean };
    assert.equal(body.status, "pending_human");
    assert.equal(body.executed, false);
    const audits = await store.audits();
    assert.equal(audits.at(-1)?.status, "confirmation_required");
  });

  it("ignores a caller flag: only the token row decides, and the action is master-admin gated", () => {
    assert.equal(skipsXosApproval({ name: "payments_add", confirm: true }, { auto_approve: false }), false);
    const actions = read("src/app/(app)/settings/mcp/actions.ts");
    const toggle = actions.indexOf("export async function setAutoApprove");
    assert.ok(toggle > 0);
    const slice = actions.slice(toggle, toggle + 500);
    assert.match(slice, /await requireMaster\(\)/);
    assert.match(slice, /auto_approve/);
    assert.ok(slice.indexOf("requireMaster") < slice.indexOf(".update("));

    const protocol = read("src/lib/mcp/protocol.ts");
    assert.match(protocol, /skipsXosApproval\(tool, token\)/);
    assert.doesNotMatch(protocol, /argsIn\.auto_approve/);
    assert.doesNotMatch(protocol, /arguments\.auto_approve/);

    const migration = read("supabase/migrations/00227_mcp_auto_approve.sql");
    assert.match(migration, /auto_approve boolean not null default false/);
    assert.doesNotMatch(migration, /update\s+public\.mcp_service_tokens/i);

    const auth = read("src/lib/mcp/auth.ts");
    assert.match(auth, /ALWAYS_HUMAN_APPROVAL_TOOLS/);
    assert.match(auth, /clients_anonymize/);
  });
});
