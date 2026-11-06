import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AI_CONSENT_BLOCKED,
  AI_CONSENT_POLICY_VERSION,
  answerAllowed,
  assistantTextHasDirectContact,
  canReadConsent,
  canWriteConsent,
  clientContactAllowed,
  consentIsActive,
  rowsForAi,
  trustedConsentClientId,
  songLineAllowed,
  songNoteAllowed,
} from "./aiConsent.ts";
import { currentMarketingConsent, marketingRowBoundToClient, marketingSendAllowed, normalizeConsentPhone } from "./smsMarketingConsent.ts";

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

  it("leaves unconsented rows out of the model payload", () => {
    const rows = [
      { id: "a", name: "Alex", allowed: true },
      { id: "b", name: "Jordan", allowed: false },
    ];
    assert.deepEqual(rowsForAi(rows), [{ id: "a", name: "Alex" }]);
  });

  it("does not let one person's opt-in cover another person's free text", () => {
    const consented = new Set(["contract-user"]);
    assert.equal(answerAllowed("guest-user", consented), false);
    assert.equal(answerAllowed(null, consented), false);
    assert.equal(answerAllowed("contract-user", consented), true);
    assert.equal(songLineAllowed("guest-user", consented, "contract-user"), false);
    assert.equal(songLineAllowed(null, consented, "contract-user"), true);
    assert.equal(songNoteAllowed(null, consented), false);
    assert.equal(songNoteAllowed("guest-user", consented), false);
    assert.equal(clientContactAllowed("cohost", new Set(["contract-client"])), false);
    assert.equal(clientContactAllowed("contract-client", new Set(["contract-client"])), true);
  });

  it("refuses emails and phone numbers in the staff assistant without claiming names are blocked", () => {
    assert.equal(assistantTextHasDirectContact("email me at alex@example.com"), true);
    assert.equal(assistantTextHasDirectContact("call 305-555-1212"), true);
    assert.equal(assistantTextHasDirectContact("the couple is Alex and Jordan"), false);
  });

  it("records marketing texts only for a real mobile number and keeps withdrawal", () => {
    assert.equal(normalizeConsentPhone(""), null);
    assert.equal(normalizeConsentPhone("305-555-1212"), "+13055551212");
    const none = currentMarketingConsent([], null);
    assert.equal(none.granted, false);
    assert.equal(none.reason, "no_mobile_number");
    const events = [
      { action: "grant" as const, phone: "+13055551212", createdAt: "2026-11-06T01:00:00Z", disclosureVersion: "2026-11-06", source: "app" },
      { action: "withdraw" as const, phone: "+13055551212", createdAt: "2026-11-06T02:00:00Z", disclosureVersion: "2026-11-06", source: "app" },
    ];
    assert.equal(currentMarketingConsent(events, "+13055551212").granted, false);
    assert.equal(currentMarketingConsent(events.slice(0, 1), "+19995550100").granted, false);
    assert.equal(marketingSendAllowed({ legacyOptIn: true, latest: { action: "grant", phone: "+13055551212" }, toNumber: "305-555-1212" }), true);
    assert.equal(marketingSendAllowed({ legacyOptIn: true, latest: { action: "grant", phone: "+13055551212" }, toNumber: "786-555-0100" }), false);
    assert.equal(marketingSendAllowed({ legacyOptIn: true, latest: { action: "withdraw", phone: "+13055551212" }, toNumber: "305-555-1212" }), false);
    assert.equal(marketingSendAllowed({ legacyOptIn: true, latest: null, toNumber: "305-555-1212" }), true);
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

  it("lets the signed-in person read a row and keeps writes on the server function", () => {
    assert.match(sql, /auth_user_id = auth\.uid\(\)/);
    assert.match(sql, /public\.xos_is_staff\(\)/);
    assert.match(sql, /for select/);
    assert.match(sql, /grant select on table public\.ai_consents to authenticated/);
    assert.match(sql, /grant execute on function public\.ai_consent_save/);
    assert.match(sql, /revoke insert, update, delete on table public\.ai_consents from service_role/);
    assert.match(sql, /new\.client_id is distinct from acct\.client_id/);
    assert.match(sql, /new\.created_at := now\(\)/);
    assert.match(sql, /AI consent identity cannot be changed/);
    assert.doesNotMatch(sql, /create policy "own insert ai consents"/);
    assert.doesNotMatch(sql, /create policy "own update ai consents"/);
    assert.doesNotMatch(sql, /event_app_members/);
    assert.doesNotMatch(sql, /for all/);
    assert.match(sql, /policy_version/);
    assert.match(sql, /withdrawn_at/);
    assert.match(sql, /source in \('app', 'web'\)/);
  });

  it("does not treat a forged consent client id as that person's opt-in", () => {
    assert.equal(trustedConsentClientId("victim-client", "real-client"), null);
    assert.equal(trustedConsentClientId("real-client", "real-client"), "real-client");
    assert.equal(trustedConsentClientId(null, "real-client"), "real-client");
    assert.equal(
      marketingRowBoundToClient({
        rowAuthUserId: "attacker",
        accountAuthUserId: "owner",
        rowPhone: "+13055551212",
        clientCellPhone: "305-555-1212",
      }),
      false,
    );
    assert.equal(
      marketingRowBoundToClient({
        rowAuthUserId: "owner",
        accountAuthUserId: "owner",
        rowPhone: "+13055551212",
        clientCellPhone: "786-555-0100",
      }),
      false,
    );
    assert.equal(
      marketingRowBoundToClient({
        rowAuthUserId: "owner",
        accountAuthUserId: "owner",
        rowPhone: "+13055551212",
        clientCellPhone: "(305) 555-1212",
      }),
      true,
    );
  });

  it("blocks personal staff tools without consent and strips the morning briefing", () => {
    assert.match(read("src/lib/eventAI.ts"), /contractClientHasAiConsent/);
    assert.match(read("src/lib/eventAI.ts"), /AI_CONSENT_BLOCKED/);
    assert.equal(AI_CONSENT_BLOCKED, "Client hasn't allowed AI tools for this event");
    assert.match(read("src/app/api/events/[id]/run-of-show/route.ts"), /contractClientHasAiConsent/);
    assert.match(read("src/lib/morningBriefing.ts"), /rowsForAi/);
    assert.match(read("src/lib/eventAI.ts"), /answerAllowed/);
    assert.match(read("src/app/api/mobile/ai-consent/route.ts"), /not_contract_client/);
    assert.match(read("src/app/api/mobile/sms-marketing-consent/route.ts"), /eligibleNumber/);
    assert.match(read("src/app/api/mobile/sms-marketing-consent/route.ts"), /clients\.cell_phone/);
    assert.match(read("src/lib/highlevel.ts"), /marketingSendAllowed/);
    assert.match(read("src/app/api/assistant/chat/route.ts"), /assistantTextHasDirectContact/);
    assert.match(read("supabase/migrations/00215_sms_marketing_consent.sql"), /sms_marketing_consent_events/);
    assert.equal(existsSync(join(root, "src/app/api/music/recommend/route.ts")), false);
    assert.match(read("src/app/(app)/events/[id]/spotify-export-actions.ts"), /contractClientHasAiConsent/);
    assert.match(read("src/app/api/mobile/ai-consent/route.ts"), /action !== "grant" && action !== "withdraw"/);
    assert.match(read("src/app/api/mobile/ai-consent/route.ts"), /ai_consent_save/);
    assert.doesNotMatch(read("src/app/api/mobile/ai-consent/route.ts"), /from\("ai_consents"\)\.upsert/);
    assert.match(read("src/app/api/mobile/sms-marketing-consent/route.ts"), /sms_marketing_consent_record/);
    assert.doesNotMatch(read("src/app/api/mobile/sms-marketing-consent/route.ts"), /from\("sms_marketing_consent_events"\)\.insert/);
    assert.match(read("src/lib/highlevel.ts"), /marketingRowBoundToClient/);
    assert.match(read("supabase/migrations/00215_sms_marketing_consent.sql"), /grant select on table public\.sms_marketing_consent_events to authenticated, service_role/);
    assert.match(read("supabase/migrations/00215_sms_marketing_consent.sql"), /SMS marketing consent history cannot be changed/);
    assert.match(read("supabase/migrations/00215_sms_marketing_consent.sql"), /new\.phone_e164 is distinct from phone/);
    assert.match(read("supabase/migrations/00215_sms_marketing_consent.sql"), /new\.created_at := now\(\)/);
    assert.doesNotMatch(read("supabase/migrations/00215_sms_marketing_consent.sql"), /create policy "own insert sms marketing consent"/);
    assert.match(read("src/app/api/mobile/ai-consent/route.ts"), /AI_CONSENT_POLICY_VERSION/);
    assert.equal(AI_CONSENT_POLICY_VERSION, "2026-11-06");
    const assistant = read("src/lib/assistantTools.ts");
    assert.match(assistant, /no client names, contacts, or addresses/);
    assert.doesNotMatch(assistant, /from\("clients"\)/);
  });
});
