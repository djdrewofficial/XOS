import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { encryptJoinToken, generateJoinToken, joinLinkUrl } from "./eventAccess.ts";
import { generateServiceToken } from "./mcp/crypto.ts";
import { handleMcp, toolText, type LiveTool } from "./mcp/protocol.ts";
import { auditView, hideClientLinks, redact } from "./mcp/redact.ts";
import { memoryStore } from "./mcp/store.ts";
import type { ServiceTokenRow } from "./mcp/auth.ts";
import { mcpTools } from "./mcp/tools/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY = "join-link-test-key-for-mcp-tool";
const ORIGIN = "https://xos.xpressdjs.com";

function withJoinEnv<T>(fn: () => Promise<T> | T): Promise<T> | T {
  const prevKey = process.env.EVENT_JOIN_CODE_KEY;
  const prevService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevApp = process.env.NEXT_PUBLIC_APP_URL;
  process.env.EVENT_JOIN_CODE_KEY = KEY;
  process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restore = () => {
    if (prevKey === undefined) delete process.env.EVENT_JOIN_CODE_KEY;
    else process.env.EVENT_JOIN_CODE_KEY = prevKey;
    if (prevService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevService;
    if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevApp;
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<T>).then === "function") {
      return (result as Promise<T>).finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

function issued(scopes: string[]) {
  const minted = generateServiceToken();
  const row: ServiceTokenRow = {
    id: "tok_join",
    name: "Join Link Agent",
    scopes,
    expires_at: null,
    revoked_at: null,
    overlap_until: null,
    token_hash: minted.hash,
  };
  return { raw: minted.raw, row };
}

function callTool(name: string, args: Record<string, unknown>, id = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

type LinkRow = { role: string; token_ciphertext: string; expires_at: string };

function fakeAdmin(opts: {
  statusName?: string | null;
  links?: LinkRow[];
  missingEvent?: boolean;
  writes?: unknown[];
}) {
  const writes = opts.writes ?? [];
  return {
    from(table: string) {
      if (table === "events") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    if (opts.missingEvent) return { data: null, error: null };
                    return {
                      data: {
                        id: EVENT,
                        name: "Demo Wedding",
                        client_id: null,
                        status: opts.statusName == null ? null : { name: opts.statusName },
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "event_join_links") {
        const filters: { column: string; value: unknown }[] = [];
        const api = {
          select() {
            return api;
          },
          eq(column: string, value: unknown) {
            filters.push({ column, value });
            return api;
          },
          async maybeSingle() {
            const role = filters.find((f) => f.column === "role")?.value;
            const row = (opts.links ?? []).find((link) => link.role === role);
            return { data: row ?? null, error: null };
          },
          insert(row: unknown) {
            writes.push({ table, op: "insert", row });
            return { then: (resolve: (v: { error: null }) => void) => resolve({ error: null }) };
          },
          upsert(row: unknown) {
            writes.push({ table, op: "upsert", row });
            return { then: (resolve: (v: { error: null }) => void) => resolve({ error: null }) };
          },
          update(row: unknown) {
            writes.push({ table, op: "update", row });
            return {
              eq() {
                return { then: (resolve: (v: { error: null }) => void) => resolve({ error: null }) };
              },
            };
          },
        };
        return api;
      }
      if (table === "email_log" || table === "sms_log" || table === "notifications" || table === "event_logs") {
        return {
          insert(row: unknown) {
            writes.push({ table, op: "insert", row });
            return { then: (resolve: (v: { error: null }) => void) => resolve({ error: null }) };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe("events_get_join_links", () => {
  const office = read("src/lib/mcp/tools/office.ts");
  const remaining = read("src/lib/mcp/tools/remaining.ts");

  it("is a read-only staff tool that never sends and does not invent a crypto path", () => {
    const tool = mcpTools.find((item) => item.name === "events_get_join_links");
    assert.ok(tool);
    assert.deepEqual(tool.scopes, ["read.events"]);
    assert.equal(tool.confirm, false);
    assert.notEqual(tool.writes, true);
    assert.equal(tool.revealJoinUrls, true);
    assert.match(tool.description, /live couple-app join link/i);
    assert.match(tool.description, /does not send/i);
    const block = office.slice(office.indexOf('name: "events_get_join_links"'), office.indexOf('name: "events_get"'));
    assert.match(block, /peekJoinLinks/);
    assert.match(block, /revealJoinUrls:\s*true/);
    assert.doesNotMatch(block, /ensureJoinLinks|resetJoinLink|emailJoinCodeToHolder|processOutbox|processSmsOutbox|writeLink/);
    assert.match(remaining, /The secret is not returned to the agent/);
    assert.match(office, /The link itself is not returned to the agent/);
    assert.equal(mcpTools.length + 2, 190);
  });

  it("filters by role, returns null when missing, and skips cancelled without erroring", async () => {
    await withJoinEnv(async () => {
      const hostToken = generateJoinToken();
      const hostUrl = joinLinkUrl(ORIGIN, hostToken);
      const expires = new Date(Date.now() + 86_400_000).toISOString();
      const writes: unknown[] = [];
      const admin = fakeAdmin({
        statusName: "Cancelled",
        links: [{ role: "host", token_ciphertext: encryptJoinToken(hostToken, KEY), expires_at: expires }],
        writes,
      });
      const tool = mcpTools.find((item) => item.name === "events_get_join_links")!;
      const both = await tool.execute({ event_id: EVENT }, {
        now: new Date(),
        token: { id: "t", name: "a", scopes: ["read.events"] },
        admin: admin as never,
      });
      const bothBody = both as {
        cancelled: boolean;
        sends: boolean;
        writes: boolean;
        links: { role: string; url: string | null; expires_at: string | null; note?: string }[];
      };
      assert.equal(bothBody.cancelled, true);
      assert.equal(bothBody.sends, false);
      assert.equal(bothBody.writes, false);
      assert.equal(bothBody.links.length, 2);
      assert.equal(bothBody.links[0]?.role, "host");
      assert.equal(bothBody.links[0]?.url, hostUrl);
      assert.equal(bothBody.links[1]?.role, "guest");
      assert.equal(bothBody.links[1]?.url, null);
      assert.match(bothBody.links[1]?.note ?? "", /no join link/i);
      assert.equal(writes.length, 0);

      const hostOnly = (await tool.execute({ event_id: EVENT, role: "host" }, {
        now: new Date(),
        token: { id: "t", name: "a", scopes: ["read.events"] },
        admin: admin as never,
      })) as { links: { role: string }[] };
      assert.deepEqual(hostOnly.links.map((row) => row.role), ["host"]);

      const guestOnly = (await tool.execute({ event_id: EVENT, role: "guest" }, {
        now: new Date(),
        token: { id: "t", name: "a", scopes: ["read.events"] },
        admin: admin as never,
      })) as { links: { role: string; url: string | null; note?: string }[] };
      assert.deepEqual(guestOnly.links.map((row) => row.role), ["guest"]);
      assert.equal(guestOnly.links[0]?.url, null);
      assert.match(guestOnly.links[0]?.note ?? "", /cancelled/i);
      assert.equal(writes.length, 0);
    });
  });

  it("enforces read.events and keeps the join token out of audit payloads while returning it to the agent", async () => {
    await withJoinEnv(async () => {
      const hostToken = generateJoinToken();
      const hostUrl = joinLinkUrl(ORIGIN, hostToken);
      const expires = new Date(Date.now() + 86_400_000).toISOString();
      const admin = fakeAdmin({
        statusName: "Booked",
        links: [{ role: "host", token_ciphertext: encryptJoinToken(hostToken, KEY), expires_at: expires }],
      });
      const { store, addToken } = memoryStore();
      const allowed = issued(["read.events"]);
      addToken(allowed.row);
      const denied = issued(["read.clients"]);
      addToken({ ...denied.row, id: "tok_denied" });

      const forbidden = await handleMcp(store, mcpTools, {
        body: callTool("events_get_join_links", { event_id: EVENT }),
        authorization: `Bearer ${denied.raw}`,
        admin: admin as never,
      });
      assert.match(JSON.stringify(forbidden.body), /Missing scope|read\.events/);

      const ok = await handleMcp(store, mcpTools, {
        body: callTool("events_get_join_links", { event_id: EVENT, role: "host" }, 2),
        authorization: `Bearer ${allowed.raw}`,
        admin: admin as never,
      });
      assert.equal(ok.status, 200);
      const payload = toolText((ok.body as { result: unknown }).result) as {
        links: { role: string; url: string | null }[];
      };
      assert.equal(payload.links[0]?.url, hostUrl);
      assert.match(JSON.stringify(ok.body), new RegExp(hostToken));

      const audits = await store.audits();
      const joinAudits = audits.filter((row) => row.toolName === "events_get_join_links");
      assert.ok(joinAudits.length >= 1);
      for (const row of joinAudits) {
        const blob = JSON.stringify(row);
        assert.equal(blob.includes(hostToken), false);
        assert.equal(blob.includes(hostUrl), false);
        assert.equal(blob.includes("/j/"), false);
        const redacted = auditView(payload);
        assert.equal(JSON.stringify(redacted).includes(hostToken), false);
      }

      const otherTool: LiveTool = {
        name: "events_list",
        description: "List events for redaction check",
        scopes: ["read.events"],
        confirm: false,
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        async execute() {
          return { note: `open ${hostUrl}` };
        },
      };
      const leaked = await handleMcp(store, [otherTool], {
        body: callTool("events_list", {}),
        authorization: `Bearer ${allowed.raw}`,
      });
      assert.doesNotMatch(JSON.stringify(leaked.body), new RegExp(hostToken));
      assert.match(JSON.stringify(leaked.body), /\[client link\]/);
    });
  });

  it("redacts join URLs by default and keeps them only when asked", () => {
    const token = generateJoinToken();
    const url = joinLinkUrl(ORIGIN, token);
    assert.equal(hideClientLinks(url), "[client link]");
    assert.equal(hideClientLinks(url, true), url);
    assert.equal((redact({ url }) as { url: string }).url, "[client link]");
    assert.equal((redact({ url }, [], 0, { keepJoinUrls: true }) as { url: string }).url, url);
    assert.equal(JSON.stringify(auditView({ url })).includes(token), false);
  });
});
