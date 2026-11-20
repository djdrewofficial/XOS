import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sql = readFileSync(join(root, "supabase/migrations/00238_helper_recipient_selection.sql"), "utf8");

describe("migration 00238 helper recipient selection", () => {
  it("adds xos_resolve_helper_recipients and a 5-arg run_booking_helper", () => {
    assert.match(sql, /create or replace function public\.xos_resolve_helper_recipients/);
    assert.match(
      sql,
      /create or replace function public\.run_booking_helper\(p_helper_id uuid, p_event_id uuid, p_sms_overrides jsonb, p_manual boolean, p_recipient_overrides jsonb\)/,
    );
    assert.match(sql, /p_recipient_overrides/);
    assert.match(sql, /UNAPPLIED until Drew approves/i);
  });

  it("supports default/all/primary/contract_holder/roles modes", () => {
    assert.match(sql, /'default'/);
    assert.match(sql, /'all'/);
    assert.match(sql, /'primary'/);
    assert.match(sql, /'contract_holder'/);
    assert.match(sql, /'roles'/);
  });

  it("skips missing email/phone per contact instead of falling back", () => {
    assert.match(sql, /no recipient email/);
    assert.match(sql, /no cell number/);
    assert.match(sql, /no matching contacts/);
  });

  it("keeps 2-arg and 3-arg wrappers for automations and legacy callers", () => {
    assert.match(sql, /create or replace function public\.run_booking_helper\(p_helper_id uuid, p_event_id uuid\)/);
    assert.match(
      sql,
      /create or replace function public\.run_booking_helper\(p_helper_id uuid, p_event_id uuid, p_sms_overrides jsonb\)/,
    );
  });
});
