import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(join(root, "supabase/migrations/00231_receipt_blocks.sql"), "utf8");

describe("migration 00231 receipt blocks", () => {
  it("seeds invoice-style Payment Receipt blocks without applying from the agent", () => {
    assert.match(migration, /00231/);
    assert.match(migration, /receipt_blocks|invoice-style smart block/i);
    assert.match(migration, /0fae46ca-0abd-481d-ba3d-579634ea792f/);
    assert.match(migration, /fee_table/);
    assert.match(migration, /showQty/);
    assert.match(migration, /showDescriptions/);
    assert.match(migration, /Total Investment/);
    assert.match(migration, /payments_received/);
    assert.match(migration, /showNotes/);
    assert.match(migration, /summary_box/);
    assert.match(migration, /payment_schedule/);
    assert.match(migration, /onlyUnpaid/);
    assert.match(migration, /hideWhenPaidInFull/);
    assert.match(migration, /Payment Receipt/);
    assert.doesNotMatch(migration, /header_kicker.*[Ii]nvoice/);
    assert.doesNotMatch(migration, /—/);
    assert.match(migration, /Do NOT apply/i);
    assert.match(migration, /00230/);
  });
});
