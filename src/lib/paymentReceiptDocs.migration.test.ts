import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(join(root, "supabase/migrations/00229_payment_receipt_docs.sql"), "utf8");

describe("migration 00229 payment receipt docs", () => {
  it("adds receipt type, editable kicker/title, fresh attach, and timezone fixes", () => {
    assert.match(migration, /doc_type in \('contract', 'quote', 'invoice', 'receipt', 'other'\)/);
    assert.match(migration, /header_kicker/);
    assert.match(migration, /title_format/);
    assert.match(migration, /fresh_on_attach/);
    assert.match(migration, /pdf_filename/);
    assert.match(migration, /xos_format_payment_date/);
    assert.match(migration, /America\/New_York/);
    assert.match(migration, /event_number/);
    assert.match(migration, /payments_received/);
    assert.match(migration, /0fae46ca-0abd-481d-ba3d-579634ea792f/);
    assert.match(migration, /attach_mode = 'pdf'/);
    assert.doesNotMatch(migration, /—/);
    assert.match(migration, /00229/);
    assert.match(migration, /renumber/i);
  });
});
