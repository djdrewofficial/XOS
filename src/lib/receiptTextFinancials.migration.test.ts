import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(join(root, "supabase/migrations/00233_receipt_text_financials_hidden.sql"), "utf8");

describe("migration 00233 receipt text financials-hidden options", () => {
  it("adds hideWhenFinancialsHidden and financialsHiddenHtml without clobbering intro html", () => {
    assert.match(migration, /00233/);
    assert.match(migration, /0fae46ca-0abd-481d-ba3d-579634ea792f/);
    assert.match(migration, /hideWhenFinancialsHidden/);
    assert.match(migration, /financialsHiddenHtml/);
    assert.match(migration, /services for your event/);
    assert.match(migration, /Preserves staff-edited intro HTML/i);
    assert.doesNotMatch(migration, /—/);
    assert.match(migration, /Do NOT apply/i);
    // Must not wholesale replace blocks with a new array of all receipt blocks
    assert.doesNotMatch(migration, /jsonb_build_array\([\s\S]*receipt-fees/);
  });
});
