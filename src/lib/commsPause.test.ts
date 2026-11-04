import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isSuppressedByCommsPause, type CommsOutboxRow } from "./commsPause.ts";

const EVENT = "1385789f-d185-48f8-a335-85063e45a6ac";
const CLIENT = "11111111-1111-1111-1111-111111111111";
const paused = new Set([EVENT]);

function row(partial: CommsOutboxRow): CommsOutboxRow {
  return { event_id: EVENT, client_id: CLIENT, ...partial };
}

describe("isSuppressedByCommsPause", () => {
  it("sends a staff-clicked helper on a paused event, including the internal copy", () => {
    // send_email stamps the event client on every recipient, custom address included.
    const clientEmail = row({ bypass_comms_pause: true });
    const internalCopy = row({ bypass_comms_pause: true });
    const clientSms = row({ bypass_comms_pause: true });
    assert.equal(isSuppressedByCommsPause(clientEmail, paused), false);
    assert.equal(isSuppressedByCommsPause(internalCopy, paused), false);
    assert.equal(isSuppressedByCommsPause(clientSms, paused), false);
  });

  it("still suppresses an automated send on a paused event", () => {
    for (const flag of [false, null, undefined]) {
      assert.equal(isSuppressedByCommsPause(row({ bypass_comms_pause: flag }), paused), true);
    }
  });

  it("sends staff alerts and mail for events that are not paused", () => {
    assert.equal(isSuppressedByCommsPause(row({ client_id: null }), paused), false);
    assert.equal(isSuppressedByCommsPause(row({ bypass_comms_pause: false }), new Set()), false);
    assert.equal(isSuppressedByCommsPause({ client_id: CLIENT, event_id: null }, paused), false);
  });
});

describe("manual vs automated origin", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const migration = readFileSync(
    join(root, "supabase/migrations/00204_manual_helper_bypasses_comms_pause.sql"),
    "utf8",
  );
  const helperClick = readFileSync(join(root, "src/app/(app)/events/actions.ts"), "utf8");
  const automations = readFileSync(join(root, "src/lib/automations.ts"), "utf8");
  const afterSign = readFileSync(join(root, "src/app/sign/[token]/actions.ts"), "utf8");

  it("stamps bypass_comms_pause from the manual flag on every helper email and SMS insert", () => {
    const inserts = [
      ...migration.matchAll(/insert into (email_log|sms_log) \([\s\S]*?\)\s*values \([\s\S]*?p_manual/g),
    ];
    assert.equal(inserts.length, 7);
    for (const insert of inserts) assert.match(insert[0], /bypass_comms_pause/);
  });

  it("treats the staff click as manual and every automatic entry point as paused", () => {
    assert.match(
      migration,
      /return public\.run_booking_helper\(p_helper_id, p_event_id, p_sms_overrides, true\)/,
    );
    assert.match(
      migration,
      /return public\.run_booking_helper\(p_helper_id, p_event_id, null::jsonb, false\)/,
    );
    // A helper chained by a run_helper action keeps the parent's origin.
    assert.match(migration, /perform run_booking_helper\(v_child, p_event_id, null::jsonb, p_manual\)/);

    assert.match(helperClick, /p_sms_overrides: cleanSmsOverrides\(smsOverrides\)/);
    assert.match(automations, /rpc\("run_booking_helper", \{ p_helper_id: h\.id, p_event_id: eventId \}\)/);
    assert.doesNotMatch(automations, /p_sms_overrides/);
    assert.match(afterSign, /p_helper_id: t\.after_sign_helper_id/);
    assert.doesNotMatch(afterSign, /p_sms_overrides/);
  });
});
