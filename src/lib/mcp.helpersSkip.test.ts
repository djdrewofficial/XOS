import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { helpersRunSkipsXosApproval, type ServiceTokenRow } from "./mcp/auth.ts";
import { generateServiceToken } from "./mcp/crypto.ts";
import { handleMcp, toolText, type LiveTool } from "./mcp/protocol.ts";
import { memoryStore } from "./mcp/store.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function issued(scopes: string[], extra: Partial<ServiceTokenRow> = {}) {
  const minted = generateServiceToken();
  const row: ServiceTokenRow = {
    id: extra.id ?? "tok_helpers",
    name: extra.name ?? "Grok Bot",
    scopes,
    expires_at: extra.expires_at ?? null,
    revoked_at: extra.revoked_at ?? null,
    overlap_until: extra.overlap_until ?? null,
    token_hash: minted.hash,
    helpers_skip_xos_approval: extra.helpers_skip_xos_approval,
  };
  return { raw: minted.raw, row };
}

function callTool(name: string, args: Record<string, unknown>, id = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

const helperTool: LiveTool = {
  name: "helpers_run",
  description: "Run a booking helper",
  scopes: ["helpers.run"],
  confirm: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["event_id", "helper_id"],
    properties: {
      event_id: { type: "string", format: "uuid" },
      helper_id: { type: "string", format: "uuid" },
    },
  },
  async preview(args) {
    return {
      effects: [{ kind: "send_sms" }],
      sms_prompts: [{ index: 0, recipients: [{ name: "Client", phone: "+15551212" }], body: "Booked" }],
      helper_id: args.helper_id,
      event_id: args.event_id,
    };
  },
  async execute(args, ctx) {
    return {
      ok: true,
      path: ctx.token.helpersSkipXosApproval ? "direct" : "held_claim",
      helper_id: args.helper_id,
      event_id: args.event_id,
      helpers_skip_xos_approval: ctx.token.helpersSkipXosApproval === true,
    };
  },
};

const emailTool: LiveTool = {
  name: "comms_send_email_template",
  description: "Send one email template",
  scopes: ["comms.email"],
  confirm: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["event_id", "template_id"],
    properties: {
      event_id: { type: "string", format: "uuid" },
      template_id: { type: "string", format: "uuid" },
    },
  },
  async preview() {
    return { to: "client@example.com" };
  },
  async execute() {
    return { ok: true };
  },
};

const EVENT = "32e79b00-bfa5-4cc1-ae4d-488b0a2fab87";
const HELPER = "d6e96c5d-eafa-4078-b73c-70ed7de26218";
const TEMPLATE = "2360d63c-50ef-450a-9102-f0bcec80e88b";

describe("helpers_run XOS approval skip", () => {
  it("only skips for helpers_run when the token row flag is true", () => {
    assert.equal(helpersRunSkipsXosApproval("helpers_run", { helpers_skip_xos_approval: true }), true);
    assert.equal(helpersRunSkipsXosApproval("helpers_run", { helpers_skip_xos_approval: false }), false);
    assert.equal(helpersRunSkipsXosApproval("helpers_run", {}), false);
    assert.equal(helpersRunSkipsXosApproval("comms_send_email_template", { helpers_skip_xos_approval: true }), false);
    assert.equal(helpersRunSkipsXosApproval("comms_send_sms", { helpers_skip_xos_approval: true }), false);
  });

  it("holds helpers_run with a receipt when the setting is off", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["helpers.run"], { helpers_skip_xos_approval: false });
    addToken(row);
    let ran = 0;
    const tool: LiveTool = {
      ...helperTool,
      async execute() {
        ran += 1;
        return { ok: true };
      },
    };
    const now = new Date("2026-11-10T12:00:00Z");
    const res = await handleMcp(store, [tool], {
      body: callTool("helpers_run", { event_id: EVENT, helper_id: HELPER, idempotency_key: "helper-hold-01" }),
      authorization: `Bearer ${raw}`,
      now,
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

  it("runs helpers_run immediately and audits when the setting is on", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["helpers.run"], {
      id: "tok_direct",
      helpers_skip_xos_approval: true,
    });
    addToken(row);
    const now = new Date("2026-11-10T12:00:00Z");
    const res = await handleMcp(store, [helperTool], {
      body: callTool("helpers_run", { event_id: EVENT, helper_id: HELPER, idempotency_key: "helper-direct-01" }),
      authorization: `Bearer ${raw}`,
      now,
    });
    const payload = toolText((res.body as { result: unknown }).result) as {
      ok: boolean;
      path: string;
      helper_id: string;
      event_id: string;
      helpers_skip_xos_approval: boolean;
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.path, "direct");
    assert.equal(payload.helper_id, HELPER);
    assert.equal(payload.event_id, EVENT);
    assert.equal(payload.helpers_skip_xos_approval, true);

    const audits = await store.audits();
    const audit = audits.at(-1)!;
    assert.equal(audit.status, "ok");
    assert.equal(audit.toolName, "helpers_run");
    assert.equal(audit.tokenId, "tok_direct");
    assert.equal(audit.confirmationId, null);
    const args = audit.argsRedacted as {
      helper_id: string;
      event_id: string;
      helpers_skip_xos_approval: boolean;
      receipt: { sms_prompts: unknown[] };
    };
    assert.equal(args.helper_id, HELPER);
    assert.equal(args.event_id, EVENT);
    assert.equal(args.helpers_skip_xos_approval, true);
    assert.ok(Array.isArray(args.receipt.sms_prompts));
    assert.match(JSON.stringify(audit), /Booked|15551212|sms_prompts/);
  });

  it("still holds non-helper send tools when the helpers skip setting is on", async () => {
    const { store, addToken } = memoryStore();
    const { raw, row } = issued(["helpers.run", "comms.email"], {
      id: "tok_email",
      helpers_skip_xos_approval: true,
    });
    addToken(row);
    let ran = 0;
    const tool: LiveTool = {
      ...emailTool,
      async execute() {
        ran += 1;
        return { ok: true };
      },
    };
    const res = await handleMcp(store, [tool, helperTool], {
      body: callTool("comms_send_email_template", {
        event_id: EVENT,
        template_id: TEMPLATE,
        idempotency_key: "email-still-hold-01",
      }),
      authorization: `Bearer ${raw}`,
      now: new Date("2026-11-10T12:00:00Z"),
    });
    assert.equal(ran, 0);
    const body = toolText((res.body as { result: unknown }).result) as { status: string; executed: boolean };
    assert.equal(body.status, "pending_human");
    assert.equal(body.executed, false);
  });

  it("rejects revoked and expired tokens even when the helpers skip setting is on", async () => {
    const { store, addToken } = memoryStore();
    const revoked = issued(["helpers.run"], {
      id: "tok_rev",
      revoked_at: "2026-01-01T00:00:00Z",
      helpers_skip_xos_approval: true,
    });
    const expired = issued(["helpers.run"], {
      id: "tok_exp",
      expires_at: "2020-01-01T00:00:00Z",
      helpers_skip_xos_approval: true,
    });
    addToken(revoked.row);
    addToken(expired.row);
    const now = new Date("2026-11-10T12:00:00Z");
    const body = callTool("helpers_run", { event_id: EVENT, helper_id: HELPER, idempotency_key: "dead-token-01" });

    const rev = await handleMcp(store, [helperTool], { body, authorization: `Bearer ${revoked.raw}`, now });
    assert.equal(rev.status, 401);
    assert.match(JSON.stringify(rev.body), /revoked/);

    const exp = await handleMcp(store, [helperTool], {
      body: callTool("helpers_run", { event_id: EVENT, helper_id: HELPER, idempotency_key: "dead-token-02" }),
      authorization: `Bearer ${expired.raw}`,
      now,
    });
    assert.equal(exp.status, 401);
    assert.match(JSON.stringify(exp.body), /expired/);
  });

  it("ignores a caller flag: only the token row decides, and the action is master-admin gated", () => {
    assert.equal(
      helpersRunSkipsXosApproval("helpers_run", { helpers_skip_xos_approval: false }),
      false,
      "a false token row must never skip",
    );
    const actions = read("src/app/(app)/settings/mcp/actions.ts");
    const toggle = actions.indexOf("export async function setHelpersSkipXosApproval");
    assert.ok(toggle > 0);
    const slice = actions.slice(toggle, toggle + 500);
    assert.match(slice, /await requireMaster\(\)/);
    assert.match(slice, /helpers_skip_xos_approval/);
    assert.ok(slice.indexOf("requireMaster") < slice.indexOf(".update("));

    const protocol = read("src/lib/mcp/protocol.ts");
    assert.match(protocol, /helpersRunSkipsXosApproval\(tool\.name, token\)/);
    assert.doesNotMatch(protocol, /argsIn\.helpers_skip/);
    assert.doesNotMatch(protocol, /arguments\.helpers_skip/);

    const office = read("src/lib/mcp/tools/office.ts");
    assert.match(office, /ctx\.token\.helpersSkipXosApproval === true/);
    assert.match(office, /executeBookingHelper/);
    assert.match(office, /mcp_run_helper_claim/);

    const migration = read("supabase/migrations/00225_mcp_helpers_skip_xos_approval.sql");
    assert.match(migration, /helpers_skip_xos_approval boolean not null default false/);
    assert.doesNotMatch(migration, /update\s+public\.mcp_service_tokens/i);
  });
});
