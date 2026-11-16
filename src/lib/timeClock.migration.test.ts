import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sql = readFileSync(join(root, "supabase/migrations/00230_time_clock.sql"), "utf8");

describe("00230 time clock migration", () => {
  it("creates punch ledger, audit, settings, view, and sync", () => {
    assert.match(sql, /create table if not exists public\.time_clock_settings/);
    assert.match(sql, /create table if not exists public\.time_punches/);
    assert.match(sql, /create table if not exists public\.time_punch_edits/);
    assert.match(sql, /hourly_rate_override/);
    assert.match(sql, /timesheet_status/);
    assert.match(sql, /v_event_staff_time_pay/);
    assert.match(sql, /xos_sync_event_staff_from_punches/);
    assert.match(sql, /Backfilled from checked_in_at/);
    assert.match(sql, /field staff scope.*time_punches/s);
    assert.match(sql, /include_travel_for_hourly_punches boolean not null default false/);
    assert.match(sql, /allow_punch_without_location boolean not null default true/);
  });
});
