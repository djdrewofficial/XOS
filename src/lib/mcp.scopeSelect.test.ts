import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MCP_SCOPES,
  MCP_SCOPE_LABELS,
  allMcpScopes,
  formatMcpScopeLabels,
  hasHighRiskMcpScope,
  mcpScopeUiComplete,
  readMcpScopes,
  toggleMcpScope,
} from "./mcp/scopes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const mintForm = readFileSync(join(root, "src/app/(app)/settings/mcp/McpAdmin.tsx"), "utf8");
const page = readFileSync(join(root, "src/app/(app)/settings/mcp/page.tsx"), "utf8");
const actions = readFileSync(join(root, "src/app/(app)/settings/mcp/actions.ts"), "utf8");

describe("MCP mint form scope selection", () => {
  it("select all checks every scope from the closed list", () => {
    const selected = allMcpScopes();
    assert.deepEqual(selected, [...MCP_SCOPES]);
    assert.equal(selected.length, MCP_SCOPES.length);
  });

  it("select all read checks exactly the read.* scopes, including read.reports", () => {
    const selected = readMcpScopes();
    assert.ok(selected.includes("read.reports"));
    assert.ok(selected.every((scope) => scope.startsWith("read.")));
    assert.deepEqual(selected, MCP_SCOPES.filter((scope) => scope.startsWith("read.")));
    assert.equal(selected.some((scope) => scope.startsWith("write.")), false);
    assert.equal(selected.includes("money"), false);
  });

  it("clear empties the checked set", () => {
    let selected = allMcpScopes();
    selected = [];
    assert.deepEqual(selected, []);
  });

  it("submitted scopes equal the checked set after toggles and bulk actions", () => {
    let selected = allMcpScopes();
    assert.deepEqual(selected, [...MCP_SCOPES]);
    selected = readMcpScopes();
    assert.deepEqual(selected, MCP_SCOPES.filter((scope) => scope.startsWith("read.")));
    selected = [];
    selected = toggleMcpScope(selected, "write.events", true);
    selected = toggleMcpScope(selected, "money", true);
    selected = toggleMcpScope(selected, "comms.email", true);
    assert.deepEqual(selected, ["write.events", "money", "comms.email"]);
    assert.equal(hasHighRiskMcpScope(selected), true);
    selected = toggleMcpScope(selected, "money", false);
    assert.deepEqual(selected, ["write.events", "comms.email"]);
  });

  it("gives every closed-list scope exactly one friendly label and group entry", () => {
    const check = mcpScopeUiComplete();
    assert.deepEqual(check, { ok: true });
    assert.deepEqual(Object.keys(MCP_SCOPE_LABELS).sort(), [...MCP_SCOPES].sort());
    assert.equal(MCP_SCOPE_LABELS["comms.contract"], "Send booking agreements");
    assert.doesNotMatch(Object.values(MCP_SCOPE_LABELS).join(" "), /\binvoice\b|\bcontract\b/i);
    assert.equal(formatMcpScopeLabels(["read.events", "money", "comms.contract"]), "View events, Payments, Send booking agreements");
    assert.match(page, /formatMcpScopeLabels/);
  });

  it("wires bulk buttons, grouped labels, and the one-time secret panel", () => {
    assert.match(mintForm, /allMcpScopes\(\)/);
    assert.match(mintForm, /readMcpScopes\(\)/);
    assert.match(mintForm, /setSelected\(\[\]\)/);
    assert.match(mintForm, /MCP_SCOPE_GROUPS/);
    assert.match(mintForm, /MCP_SCOPE_LABELS/);
    assert.match(mintForm, /TokenSecretPanel/);
    assert.match(mintForm, /This is the only time you will see this key/);
    assert.match(mintForm, /"Copy"/);
    assert.match(mintForm, /"Copied"/);
    assert.match(mintForm, /Done, I've copied it/);
    assert.match(actions, /acknowledgeMcpTokenFlash/);
    assert.equal((mintForm.match(/type="button"/g) ?? []).length >= 5, true);
  });
});
