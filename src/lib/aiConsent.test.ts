import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AI_CONSENT_BLOCKED,
  AI_CONSENT_POLICY_VERSION,
  briefingEventForAi,
  canReadConsent,
  canWriteConsent,
  consentIsActive,
} from "./aiConsent.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("AI consent state", () => {
  it("treats missing, withdrawn, and re-granted rows correctly", () => {
    assert.equal(consentIsActive(null), false);
    assert.equal(consentIsActive({ granted_at: null, withdrawn_at: null }), false);
    assert.equal(consentIsActive({ granted_at: "2026-11-06T00:00:00Z", withdrawn_at: null }), true);
    assert.equal(
      consentIsActive({ granted_at: "2026-11-01T00:00:00Z", withdrawn_at: "2026-11-02T00:00:00Z" }),
      false,
    );
    assert.equal(
      consentIsActive({ granted_at: "2026-11-03T00:00:00Z", withdrawn_at: "2026-11-02T00:00:00Z" }),
      true,
    );
  });

  it("strips names and venue when consent is absent and keeps them when it is present", () => {
    const event = { id: "evt", name: "Alex and Jordan", venue: "123 Main St" };
    assert.deepEqual(briefingEventForAi(event, false), { id: "evt", name: "Private event", venue: null });
    assert.deepEqual(briefingEventForAi(event, true), event);
  });

  it("lets a client read and change only their own row, and lets staff read only", () => {
    const client = { staff: false, authUserId: "client-1", onEvent: true };
    const other = { staff: false, authUserId: "client-2", onEvent: true };
    const staff = { staff: true, authUserId: "staff-1", onEvent: true };
    const outsider = { staff: false, authUserId: "client-1", onEvent: false };
    assert.equal(canReadConsent(client, "client-1"), true);
    assert.equal(canReadConsent(client, "client-2"), false);
    assert.equal(canReadConsent(staff, "client-1"), true);
    assert.equal(canWriteConsent(client, "client-1"), true);
    assert.equal(canWriteConsent(other, "client-1"), false);
    assert.equal(canWriteConsent(staff, "client-1"), false);
    assert.equal(canWriteConsent(outsider, "client-1"), false);
  });
});

describe("AI consent schema and call sites", () => {
  const sql = read("supabase/migrations/00214_ai_consent.sql");

  it("locks consent rows to the owner for writes and to staff for read", () => {
    assert.match(sql, /auth_user_id = auth\.uid\(\)/);
    assert.match(sql, /public\.xos_is_staff\(\)/);
    assert.match(sql, /for select/);
    assert.match(sql, /for insert/);
    assert.match(sql, /for update/);
    assert.match(sql, /not public\.xos_is_staff\(\)/);
    assert.doesNotMatch(sql, /for all/);
    assert.match(sql, /policy_version/);
    assert.match(sql, /withdrawn_at/);
    assert.match(sql, /source in \('app', 'web'\)/);
  });

  it("blocks personal staff tools without consent and strips the morning briefing", () => {
    assert.match(read("src/lib/eventAI.ts"), /contractClientHasAiConsent/);
    assert.match(read("src/lib/eventAI.ts"), /AI_CONSENT_BLOCKED/);
    assert.equal(AI_CONSENT_BLOCKED, "Client hasn't allowed AI tools for this event");
    assert.match(read("src/app/api/events/[id]/run-of-show/route.ts"), /contractClientHasAiConsent/);
    assert.match(read("src/lib/morningBriefing.ts"), /briefingEventForAi/);
    assert.match(read("src/app/api/music/recommend/route.ts"), /callerHasAiConsent/);
    assert.match(read("src/app/(app)/events/[id]/spotify-export-actions.ts"), /contractClientHasAiConsent/);
    assert.match(read("src/app/api/mobile/ai-consent/route.ts"), /action !== "grant" && action !== "withdraw"/);
    assert.match(read("src/app/api/mobile/ai-consent/route.ts"), /AI_CONSENT_POLICY_VERSION/);
    assert.equal(AI_CONSENT_POLICY_VERSION, "2026-11-06");
    const assistant = read("src/lib/assistantTools.ts");
    assert.match(assistant, /no client names, contacts, or addresses/);
    assert.doesNotMatch(assistant, /from\("clients"\)/);
  });
});
