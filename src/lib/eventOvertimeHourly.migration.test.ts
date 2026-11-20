import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sql = readFileSync(join(root, "supabase/migrations/00237_event_overtime_hourly.sql"), "utf8");
const office = readFileSync(join(root, "src/lib/mcp/tools/office.ts"), "utf8");

describe("migration 00237 event overtime_hourly", () => {
  it("adds nullable events.overtime_hourly without backfill or package value changes", () => {
    assert.match(sql, /add column if not exists overtime_hourly numeric\(10,2\) null/);
    assert.match(sql, /No backfill/i);
    assert.doesNotMatch(sql, /update\s+public\.events\s+set\s+overtime_hourly/i);
    assert.doesNotMatch(sql, /update\s+public\.packages\s+set\s+overtime_hourly/i);
  });

  it("patches render_merge_tags so <overtime_rate> prefers the event override", () => {
    assert.match(sql, /coalesce\(e\.overtime_hourly,/);
    assert.match(sql, /pg_get_functiondef\('public\.render_merge_tags\(uuid,text\)'/);
    assert.match(sql, /p\.overtime_hourly, 0\)/);
  });
});

describe("MCP events_update_financials overtime_hourly", () => {
  it("accepts overtime_hourly and treats null as clear-override", () => {
    assert.match(office, /name: "events_update_financials"/);
    assert.match(office, /overtime_hourly: \{ type: "number", minimum: 0 \}/);
    assert.match(office, /overtimeHourlyProvided/);
    assert.match(office, /args\.overtime_hourly == null/);
    assert.match(office, /effective_overtime_hourly/);
    assert.match(office, /effectiveOvertimeHourly/);
  });

  it("exposes effective_overtime_hourly on events_get when money scope is present", () => {
    assert.match(office, /name: "events_get"/);
    assert.match(office, /overtime_hourly, overtime_fee/);
    assert.match(office, /out\.effective_overtime_hourly/);
  });
});
