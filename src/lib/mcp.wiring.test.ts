import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const RISKY = /^(money|money\.payroll|delete|comms\.|helpers\.run)/;
const READ_ONLY_RISKY = new Set([
  "payments_list",
  "reports_outstanding",
  "helpers_preview",
  "helpers_list",
  "email_templates_list",
  "payments_proposal_link",
]);

function catalog(source: string) {
  const tools = [];
  const re = /name: "([^"]+)",\s*description:\s*"([\s\S]*?)",\s*scopes: \[([^\]]*)\],\s*confirm: (true|false)/g;
  for (const match of source.matchAll(re)) {
    const scopes = match[3].match(/"([^"]+)"/g)?.map((item) => item.slice(1, -1)) ?? [];
    tools.push({ name: match[1], description: match[2], scopes, confirm: match[4] === "true" });
  }
  return tools;
}

describe("mcp tool catalog", () => {
  it("names every tool once, with a description and a closed schema", () => {
    const tools = catalog(read("src/lib/mcp/tools/office.ts"));
    assert.ok(tools.length >= 40);
    const names = tools.map((tool) => tool.name);
    assert.equal(new Set(names).size, names.length);
    for (const tool of tools) assert.ok(tool.description.length > 20, tool.name);
    assert.match(read("src/lib/mcp/tools/office.ts"), /additionalProperties: false/);
  });

  it("confirms money, deletes, outbound messages, and helper runs", () => {
    const tools = catalog(read("src/lib/mcp/tools/office.ts"));
    for (const tool of tools) {
      const risky = tool.scopes.some((scope) => RISKY.test(scope));
      if (risky && !READ_ONLY_RISKY.has(tool.name)) assert.equal(tool.confirm, true, tool.name);
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.get("documents_send_for_signature")?.confirm, true);
    assert.deepEqual(byName.get("documents_send_for_signature")?.scopes, ["comms.contract"]);
    assert.equal(byName.get("helpers_run")?.confirm, true);
    assert.equal(byName.get("payments_add")?.confirm, true);
    assert.equal(byName.get("events_list")?.confirm, false);
  });

  it("sends contracts and helper mail through the app, not a raw insert", () => {
    const office = read("src/lib/mcp/tools/office.ts");
    const send = read("src/lib/sendForSignature.ts");
    const helper = read("src/lib/bookingHelperRun.ts");
    assert.match(office, /sendDocumentForSignature/);
    assert.match(office, /executeBookingHelper/);
    assert.match(send, /agreementEmailHtml/);
    assert.match(send, /processOutbox/);
    assert.match(helper, /run_booking_helper/);
    assert.match(helper, /drainEventOutbox/);
    assert.doesNotMatch(helper, /processOutbox\(/);
    assert.doesNotMatch(helper, /processSmsOutbox\(/);
    assert.doesNotMatch(office, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(send, /console\.log/);
  });

  it("keeps the connector off the login wall and off the Cloudflare origin lock", () => {
    const middleware = read("src/middleware.ts");
    assert.match(middleware, /pathname === "\/api\/mcp"/);
    assert.match(middleware, /p === "\/api\/mcp"/);
  });

  it("documents every tool and stores tokens as hashes", () => {
    const docs = read("docs/mcp.md");
    const migration = read("supabase/migrations/00217_mcp_service_access.sql");
    for (const tool of catalog(read("src/lib/mcp/tools/office.ts"))) assert.match(docs, new RegExp(`\\b${tool.name}\\b`));
    assert.match(docs, /xos_whoami/);
    assert.match(docs, /xos_confirm/);
    assert.match(migration, /token_hash/);
    assert.match(migration, /enable row level security/);
    assert.match(migration, /revoke all on public\.mcp_service_tokens/);
    assert.doesNotMatch(docs, /service_role/i);
  });
});
