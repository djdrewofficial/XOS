import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MCP_SCOPES,
  allMcpScopes,
  hasHighRiskMcpScope,
  readMcpScopes,
  toggleMcpScope,
} from "./mcp/scopes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const mintForm = readFileSync(join(root, "src/app/(app)/settings/mcp/McpAdmin.tsx"), "utf8");
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
    assert.equal(selected.length, 0);
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
    assert.equal(hasHighRiskMcpScope(["write.events"]), false);
    assert.equal(hasHighRiskMcpScope(["delete"]), true);
    assert.equal(hasHighRiskMcpScope(["money.payroll"]), true);
    assert.equal(hasHighRiskMcpScope(["comms.sms"]), true);
  });

  it("wires the bulk buttons as type=button and keeps checkboxes controlled from MCP_SCOPES", () => {
    assert.match(mintForm, /allMcpScopes\(\)/);
    assert.match(mintForm, /readMcpScopes\(\)/);
    assert.match(mintForm, /setSelected\(\[\]\)/);
    assert.equal((mintForm.match(/type="button"/g) ?? []).length >= 3, true);
    assert.match(mintForm, /checked=\{selected\.includes\(scope\)\}/);
    assert.match(mintForm, /name="scope"/);
    assert.match(mintForm, /hasHighRiskMcpScope\(selected\)/);
    assert.match(actions, /acknowledgeMcpTokenFlash/);
  });
});
