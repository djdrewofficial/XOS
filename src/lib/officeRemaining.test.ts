import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EditorDb, EditorQuery } from "./officeEdits.ts";
import {
  appInvitePlan,
  decideSmsConsent,
  deleteArticle,
  deleteReminderRule,
  employeePhotoPath,
  employeeProfilePatch,
  removeAppMemberDecision,
  restoreHidden,
  revertOverrideDecision,
  saveEmployeeProfile,
  saveNamedRow,
  saveSmsConsent,
  signingFieldKeys,
  staffSettingsPatch,
} from "./officeRemaining.ts";

type Row = Record<string, unknown>;

function memoryDb(seed: Record<string, Row[]> = {}): { db: EditorDb; tables: Record<string, Row[]> } {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const ensure = (table: string) => (tables[table] ??= []);
  function query(table: string, mode: "select" | "insert" | "update" | "delete", payload?: Row | Row[]): EditorQuery {
    const filters: { op: string; column: string; value: unknown }[] = [];
    const match = (row: Row) => filters.every((filter) => filter.op !== "eq" || row[filter.column] === filter.value);
    const run = () => {
      const rows = ensure(table);
      if (mode === "insert") {
        const incoming = (Array.isArray(payload) ? payload : [payload as Row]).map((item) => ({ id: item.id ?? crypto.randomUUID(), ...item }));
        rows.push(...incoming);
        return { data: incoming, error: null };
      }
      const found = rows.filter(match);
      if (mode === "update") {
        for (const item of found) Object.assign(item, payload);
        return { data: found, error: null };
      }
      if (mode === "delete") {
        tables[table] = rows.filter((item) => !found.includes(item));
        return { data: found, error: null };
      }
      return { data: found, error: null };
    };
    const api = {
      eq(column: string, value: unknown) { filters.push({ op: "eq", column, value }); return api; },
      in() { return api; },
      gte() { return api; },
      neq() { return api; },
      order() { return api; },
      limit() { return api; },
      select() { return api; },
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => run(),
      then(resolve: (value: { data: unknown; error: null }) => void) { resolve(run()); },
    };
    return api as EditorQuery;
  }
  return {
    tables,
    db: {
      from(table: string) {
        return {
          select: () => query(table, "select"),
          insert: (row: Row | Row[]) => query(table, "insert", row),
          update: (patch: Row) => query(table, "update", patch),
          delete: () => query(table, "delete"),
        };
      },
    },
  };
}

const employee = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const contentId = "33333333-3333-4333-8333-333333333333";

describe("remaining office handlers", () => {
  it("rejects role escalation and saves the allowed profile fields", async () => {
    assert.throws(() => employeeProfilePatch("general", { first_name: "Ada", last_name: "Lovelace", permission_tier: "master_admin" }), /permission_tier/);
    assert.throws(() => employeeProfilePatch("contact", { email: "ada@example.com", can_send_as_self: true }), /can_send_as_self/);
    const { db, tables } = memoryDb({ employees: [{ id: employee, first_name: "Old" }] });
    const saved = await saveEmployeeProfile(db, employee, "general", { first_name: "Ada", last_name: "Lovelace", staff_category: "DJ" });
    assert.equal(saved.first_name, "Ada");
    assert.equal("permission_tier" in saved, false);
    assert.equal(tables.employees[0].last_name, "Lovelace");
    assert.throws(() => employeePhotoPath(employee, "../x.png", "image/svg+xml"), /PNG/);
  });

  it("refuses manufactured consent and does not clear STOP as a side effect", async () => {
    assert.throws(() => decideSmsConsent({ action: "grant_marketing", evidence: "", source: "staff_record", statedAt: "2026-11-09T00:00:00Z", currentlyStopped: false }), /what the client said/);
    assert.throws(() => decideSmsConsent({ action: "grant_marketing", evidence: "Client said yes on the phone", source: "imported", statedAt: "2026-11-09T00:00:00Z", currentlyStopped: false }), /staff_record/);
    assert.throws(() => decideSmsConsent({ action: "grant_marketing", evidence: "Client said yes on the phone", source: "staff_record", statedAt: "2026-11-09T00:00:00Z", currentlyStopped: true }), /does not override STOP/);
    const { db, tables } = memoryDb({ clients: [{ id: employee, sms_opt_in: false }] });
    await assert.rejects(() => saveSmsConsent(db, employee, { action: "grant_marketing", evidence: "Client said yes on the phone", source: "staff_record", statedAt: "2026-11-09T00:00:00Z" }, { phone: "+13055550100", stopped: true }), /STOP/);
    assert.equal(tables.clients[0].sms_opt_in, false);
    const granted = await saveSmsConsent(db, employee, { action: "grant_marketing", evidence: "Client said yes on the phone", source: "staff_record", statedAt: "2026-11-09T00:00:00Z" }, { phone: "+13055550100", stopped: false });
    assert.equal(granted.marketing, true);
    assert.equal(tables.clients[0].sms_opt_in_at, "2026-11-09T00:00:00Z");
    assert.equal(tables.clients[0].sms_opt_in_evidence, "Client said yes on the phone");
  });

  it("restores only a known content type and checks the database error", async () => {
    const { db, tables } = memoryDb({ planning_songs: [{ id: contentId, event_id: eventId, hidden_at: "2026-01-01" }] });
    await restoreHidden(db, eventId, "song", contentId);
    assert.equal(tables.planning_songs[0].hidden_at, null);
    await assert.rejects(() => restoreHidden(db, eventId, "password", contentId), /cannot be restored/);
    const broken = { from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ then: (ok: (v: unknown) => void) => ok({ data: null, error: { message: "permission denied" } }) }) }) }) }) };
    await assert.rejects(() => restoreHidden(broken as unknown as EditorDb, eventId, "song", contentId), /permission denied/);
  });

  it("covers category, reminder, article, member, and settings guards", async () => {
    const { db, tables } = memoryDb({
      payment_reminder_rules: [{ id: contentId }],
      kb_articles: [{ id: contentId, is_active: true }],
    });
    await saveNamedRow(db, "vendor_categories", { name: "Photo" });
    assert.equal(tables.vendor_categories[0].name, "Photo");
    await deleteReminderRule(db, contentId);
    assert.equal(tables.payment_reminder_rules.length, 0);
    await deleteArticle(db, contentId);
    assert.equal(tables.kb_articles.length, 0);
    assert.equal(appInvitePlan("reset_link").returns_secret, false);
    assert.throws(() => removeAppMemberDecision({ onEvent: true, isContractHolder: true, isPrimary: false, isAnchor: false }), /contract holder/);
    assert.throws(() => signingFieldKeys(["password"]), /not recognized/);
    assert.throws(() => staffSettingsPatch("features", { feat_time_off: true, permission_tier: "admin" }), /permission_tier/);
  });

  it("will not revert a message that already went out", () => {
    assert.equal(revertOverrideDecision("pending", false), "delete");
    assert.throws(() => revertOverrideDecision("sent", true), /already went out/);
  });
});
