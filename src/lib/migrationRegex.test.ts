import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

// PostgreSQL's regex engine rejects a bounded repeat above this (RE_DUP_MAX)
// at execution time: "invalid regular expression: invalid repetition count(s)".
const RE_DUP_MAX = 255;

// Already applied. 00211 replaces the two checks. Do not edit 00210 to satisfy this test.
const FROZEN_OVER_LIMIT = "00210_staff_passkeys.sql";

/** Bounded repeats Postgres will refuse. `{n,}` is legal when n is at most 255. */
function repetitionsOverLimit(sql: string, max = RE_DUP_MAX): string[] {
  const hits: string[] = [];
  const re = /\{(\d+)(,(\d+)?)?\}/g;
  for (const match of sql.matchAll(re)) {
    const low = Number(match[1]);
    const hasComma = match[2] !== undefined;
    const high = match[3] === undefined ? null : Number(match[3]);
    const upper = hasComma ? high : low;
    if (low > max || (upper !== null && upper > max)) hits.push(match[0]);
  }
  return hits;
}

describe("postgres regex repetition limit", () => {
  it("flags a count above 255 and leaves a legal or open-ended repeat alone", () => {
    assert.deepEqual(repetitionsOverLimit("{16,255}"), []);
    assert.deepEqual(repetitionsOverLimit("{255}"), []);
    assert.deepEqual(repetitionsOverLimit("{16,}"), []);
    assert.deepEqual(repetitionsOverLimit("{32,128}"), []);
    assert.deepEqual(repetitionsOverLimit("{64}"), []);
    assert.deepEqual(repetitionsOverLimit("default '{1,2,3}'"), []);
    assert.deepEqual(repetitionsOverLimit("{16,256}"), ["{16,256}"]);
    assert.deepEqual(repetitionsOverLimit("{256}"), ["{256}"]);
    assert.deepEqual(repetitionsOverLimit("{256,}"), ["{256,}"]);
    assert.deepEqual(repetitionsOverLimit("{16,512}"), ["{16,512}"]);
    assert.deepEqual(repetitionsOverLimit("{16,4096}"), ["{16,4096}"]);
  });

  it("keeps every migration at or under 255 except the frozen passkey file repaired by 00211", () => {
    const dir = join(root, "supabase/migrations");
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    const offenders: string[] = [];
    for (const file of files) {
      if (file === FROZEN_OVER_LIMIT) continue;
      for (const hit of repetitionsOverLimit(readFileSync(join(dir, file), "utf8"))) {
        offenders.push(`${file}: ${hit}`);
      }
    }
    assert.deepEqual(offenders, []);

    const original = readFileSync(join(dir, FROZEN_OVER_LIMIT), "utf8");
    assert.deepEqual(repetitionsOverLimit(original), ["{16,512}", "{16,4096}"]);

    const fix = readFileSync(join(dir, "00211_fix_passkey_checks.sql"), "utf8");
    assert.match(fix, /drop constraint if exists staff_passkeys_credential_id/);
    assert.match(fix, /drop constraint if exists staff_passkeys_public_key/);
    assert.match(fix, /char_length\(credential_id\) between 16 and 512/);
    assert.match(fix, /credential_id ~ '\^\[A-Za-z0-9_-\]\+\$'/);
    assert.match(fix, /char_length\(public_key\) between 16 and 4096/);
    assert.match(fix, /public_key ~ '\^\[A-Za-z0-9_-\]\+\$'/);
    assert.deepEqual(repetitionsOverLimit(fix), []);
  });
});
