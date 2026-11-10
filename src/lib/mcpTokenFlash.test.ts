import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { completeMintedToken, mintTokenFlash, rotateTokenFlash, type TokenFlashStore } from "./mcpTokenFlash.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const actions = readFileSync(join(root, "src/app/(app)/settings/mcp/actions.ts"), "utf8");
const admin = readFileSync(join(root, "src/app/(app)/settings/mcp/McpAdmin.tsx"), "utf8");

function memoryStore(opts?: { failOverlap?: boolean; failRevoke?: boolean; failAfter?: boolean }) {
  const rows: { id: string; revoked_at?: string; overlap_until?: string; name: string }[] = [];
  const store: TokenFlashStore = {
    async insert(row) {
      const id = `id-${rows.length + 1}`;
      rows.push({ id, name: row.name });
      return { id };
    },
    async setOverlap(id, overlapUntil) {
      if (opts?.failOverlap) return { error: "overlap failed" };
      const row = rows.find((item) => item.id === id);
      if (row) row.overlap_until = overlapUntil;
      return { error: null };
    },
    async revoke(id, at) {
      if (opts?.failRevoke) return { error: "revoke failed" };
      const row = rows.find((item) => item.id === id);
      if (row) row.revoked_at = at;
      return { error: null };
    },
  };
  return { store, rows, opts };
}

describe("one-time MCP token flash", () => {
  it("returns the secret after insert without refreshing the page first", async () => {
    const { store, rows } = memoryStore();
    const flash = await mintTokenFlash(store, {
      name: "Grok Bot",
      scopes: ["read.events"],
      expiresAt: null,
      note: null,
      createdBy: "user-1",
      minted: { raw: "xos_mcp_secret", prefix: "xos_mcp_abcd", hash: "hash" },
    });
    assert.deepEqual(flash, { token: "xos_mcp_secret", prefix: "xos_mcp_abcd", name: "Grok Bot" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revoked_at, undefined);
    // Refreshing before returning the secret remounts MintForm and drops useActionState.
    assert.doesNotMatch(actions, /revalidatePath\("\/settings\/mcp"\);\s*return \{ token:/);
    assert.match(actions, /acknowledgeMcpTokenFlash/);
    assert.match(admin, /TokenSecretPanel/);
    assert.match(admin, /This is the only time you will see this key/);
    assert.match(admin, /"Copy"/);
    assert.match(admin, /"Copied"/);
    assert.match(admin, /Done, I've copied it/);
    assert.match(admin, /navigator\.clipboard\.writeText/);
  });

  it("revokes the inserted row when post-insert work fails, so a secretless token is not left active", async () => {
    const { store, rows } = memoryStore();
    const failed = await completeMintedToken(
      store,
      "id-keep",
      { token: "secret", prefix: "xos_mcp_ab", name: "Bot" },
      async () => {
        rows.push({ id: "id-keep", name: "Bot" });
        throw new Error("revalidate blew up");
      },
    );
    assert.deepEqual(failed, { error: "revalidate blew up" });
    assert.ok(rows[0].revoked_at);

    const rotateStore = memoryStore({ failOverlap: true });
    const rotated = await rotateTokenFlash(rotateStore.store, {
      oldId: "old",
      name: "Bot",
      scopes: ["read.events"],
      expiresAt: null,
      note: null,
      createdBy: null,
      overlapUntil: "2026-01-01T00:00:00.000Z",
      minted: { raw: "xos_mcp_new", prefix: "xos_mcp_new1", hash: "hash2" },
    });
    assert.match(String((rotated as { error: string }).error), /Rotation did not finish|revoked/);
    assert.ok(rotateStore.rows[0].revoked_at);

    const revokeFail = memoryStore({ failRevoke: true });
    revokeFail.rows.push({ id: "id-1", name: "Bot" });
    const stuck = await completeMintedToken(
      revokeFail.store,
      "id-1",
      { token: "secret", prefix: "pref", name: "Bot" },
      async () => {
        throw new Error("boom");
      },
    );
    assert.match(String((stuck as { error: string }).error), /revoking it failed/);
  });
});
