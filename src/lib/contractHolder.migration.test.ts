import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONTRACT_HOLDER_MERGE_TAGS } from "./contractHolder.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sql = readFileSync(join(root, "supabase/migrations/00239_merge_tags_contract_holder.sql"), "utf8");

describe("migration 00239 merge tags contract holder", () => {
  it("patches render_merge_tags to prefer is_contract_holder", () => {
    assert.match(sql, /is_contract_holder/);
    assert.match(sql, /pg_get_functiondef\('public\.render_merge_tags\(uuid,text\)'/);
    assert.match(sql, /role.*planner/i);
    assert.match(sql, /e\.client_id/);
    assert.match(sql, /UNAPPLIED until Drew approves/i);
  });

  it("documents the client-facing tags that change", () => {
    for (const tag of CONTRACT_HOLDER_MERGE_TAGS) {
      assert.match(sql, new RegExp(`<${tag}>`));
    }
  });
});
