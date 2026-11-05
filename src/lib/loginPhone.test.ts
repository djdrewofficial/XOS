import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toE164 } from "./phone.ts";
import {
  PHONE_SYNC_FAILED_NOTICE,
  PHONE_TAKEN_NOTICE,
  authPhoneUpdate,
  syncLoginPhone,
  type PhoneOwner,
  type SyncLoginPhoneDeps,
} from "./loginPhone.ts";

const STAFF = "staff-user";
const CLIENT = "client-user";
const OTHER_STAFF = "other-staff";

type User = PhoneOwner & { phone: string | null };

function harness(users: User[]) {
  const calls: { id: string; phone: string | null }[] = [];
  const logs: string[] = [];
  const deps: SyncLoginPhoneDeps = {
    normalize: toE164,
    log: (message) => logs.push(message),
    findByPhone: async (e164) => users.find((user) => user.phone === e164) ?? null,
    setPhone: async (id, phone) => {
      calls.push({ id, phone });
      if (phone) {
        const other = users.find((user) => user.phone === phone && user.id !== id);
        if (other) return { error: "Phone number already registered by another user" };
      }
      const user = users.find((row) => row.id === id);
      if (user) user.phone = phone;
      return { error: null };
    },
  };
  return { calls, logs, deps, users };
}

describe("auth phone payload", () => {
  it("confirms an E.164 number and sends a blank phone to clear", () => {
    assert.deepEqual(authPhoneUpdate("+13055550199"), { phone: "+13055550199", phone_confirm: true });
    assert.deepEqual(authPhoneUpdate(null), { phone: "" });
  });
});

describe("syncLoginPhone", () => {
  it("stores US and international numbers as E.164", async () => {
    const us = harness([{ id: STAFF, phone: null, accountType: "staff" }]);
    const usResult = await syncLoginPhone(
      { userId: STAFF, phone: "305-555-0199", source: "staff" },
      us.deps,
    );
    assert.equal(usResult.status, "updated");
    assert.equal(usResult.phone, "+13055550199");
    assert.deepEqual(us.calls, [{ id: STAFF, phone: "+13055550199" }]);

    const co = harness([{ id: CLIENT, phone: null, accountType: "client" }]);
    const coResult = await syncLoginPhone(
      { userId: CLIENT, phone: "+57 300 123 4567", source: "client" },
      co.deps,
    );
    assert.equal(coResult.status, "updated");
    assert.equal(coResult.phone, "+573001234567");
    assert.deepEqual(co.calls, [{ id: CLIENT, phone: "+573001234567" }]);
  });

  it("skips a number toE164 cannot normalize", async () => {
    const h = harness([{ id: STAFF, phone: "+13055550100", accountType: "staff" }]);
    const result = await syncLoginPhone(
      { userId: STAFF, phone: "57 300 123 4567", previousPhone: "305-555-0100", source: "staff" },
      h.deps,
    );
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "invalid");
    assert.equal(h.calls.length, 0);
    assert.equal(h.users[0]?.phone, "+13055550100");
  });

  it("skips a too-short international value", async () => {
    const h = harness([{ id: CLIENT, phone: null, accountType: "client" }]);
    const result = await syncLoginPhone({ userId: CLIENT, phone: "+57", source: "client" }, h.deps);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "invalid");
    assert.equal(h.calls.length, 0);
  });

  it("clears only when a real number changes to empty", async () => {
    const h = harness([{ id: STAFF, phone: "+13055550100", accountType: "staff" }]);
    const result = await syncLoginPhone(
      { userId: STAFF, phone: "", previousPhone: "305-555-0100", source: "staff" },
      h.deps,
    );
    assert.equal(result.status, "cleared");
    assert.deepEqual(h.calls, [{ id: STAFF, phone: null }]);
    assert.equal(h.users[0]?.phone, null);
  });

  it("does not clear when an edit saves an unchanged empty phone", async () => {
    const h = harness([{ id: STAFF, phone: "+13055550199", accountType: "staff" }]);
    const result = await syncLoginPhone(
      { userId: STAFF, phone: "", previousPhone: "", source: "staff" },
      h.deps,
    );
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "unchanged_empty");
    assert.equal(h.calls.length, 0);
    assert.equal(h.users[0]?.phone, "+13055550199");

    const alsoNull = await syncLoginPhone(
      { userId: STAFF, phone: null, previousPhone: null, source: "staff" },
      h.deps,
    );
    assert.equal(alsoNull.reason, "unchanged_empty");
    assert.equal(h.calls.length, 0);
  });

  it("does not clear on invite when the person record has no phone", async () => {
    const h = harness([{ id: STAFF, phone: "+13055550199", accountType: "staff" }]);
    const result = await syncLoginPhone({ userId: STAFF, phone: null, source: "staff" }, h.deps);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "empty");
    assert.equal(h.calls.length, 0);
  });

  it("does not clear when the old value was never a syncable number", async () => {
    const h = harness([{ id: STAFF, phone: "+13055550199", accountType: "staff" }]);
    const result = await syncLoginPhone(
      { userId: STAFF, phone: "", previousPhone: "n/a", source: "staff" },
      h.deps,
    );
    assert.equal(result.reason, "unchanged_empty");
    assert.equal(h.calls.length, 0);
  });

  it("skips a collision instead of throwing", async () => {
    const h = harness([
      { id: STAFF, phone: null, accountType: "staff" },
      { id: OTHER_STAFF, phone: "+13055550199", accountType: "staff" },
    ]);
    const result = await syncLoginPhone(
      { userId: STAFF, phone: "(305) 555-0199", source: "staff" },
      h.deps,
    );
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "collision");
    assert.equal(result.notice, PHONE_TAKEN_NOTICE);
    assert.equal(h.calls.length, 0);
    assert.ok(h.logs.some((line) => line.includes("another login")));
    assert.equal(h.users[1]?.phone, "+13055550199");
  });

  it("lets a staff record take the number from a client login", async () => {
    const h = harness([
      { id: STAFF, phone: null, accountType: "staff" },
      { id: CLIENT, phone: "+13055550199", accountType: "client" },
    ]);
    const result = await syncLoginPhone(
      { userId: STAFF, phone: "305-555-0199", source: "staff" },
      h.deps,
    );
    assert.equal(result.status, "updated");
    assert.equal(result.notice, undefined);
    assert.deepEqual(h.calls, [
      { id: CLIENT, phone: null },
      { id: STAFF, phone: "+13055550199" },
    ]);
    assert.equal(h.users.find((user) => user.id === CLIENT)?.phone, null);
    assert.equal(h.users.find((user) => user.id === STAFF)?.phone, "+13055550199");
  });

  it("does not take a number from a client when the edit is a client record", async () => {
    const h = harness([
      { id: CLIENT, phone: null, accountType: "client" },
      { id: "other-client", phone: "+13055550199", accountType: "client" },
    ]);
    const result = await syncLoginPhone(
      { userId: CLIENT, phone: "305-555-0199", source: "client" },
      h.deps,
    );
    assert.equal(result.reason, "collision");
    assert.equal(result.notice, PHONE_TAKEN_NOTICE);
    assert.equal(h.calls.length, 0);
  });

  it("does not let a client record take the number from a staff login", async () => {
    const h = harness([
      { id: CLIENT, phone: null, accountType: "client" },
      { id: STAFF, phone: "+13055550199", accountType: "staff" },
    ]);
    const result = await syncLoginPhone(
      { userId: CLIENT, phone: "305-555-0199", source: "client" },
      h.deps,
    );
    assert.equal(result.reason, "collision");
    assert.equal(h.calls.length, 0);
    assert.equal(h.users.find((user) => user.id === STAFF)?.phone, "+13055550199");
  });

  it("does not throw when the phone update reports the number is taken", async () => {
    const h = harness([{ id: STAFF, phone: null, accountType: "staff" }]);
    h.deps.setPhone = async () => ({ error: 'duplicate key value violates unique constraint "users_phone_key"' });
    const result = await syncLoginPhone({ userId: STAFF, phone: "305-555-0199", source: "staff" }, h.deps);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "collision");
    assert.equal(result.notice, PHONE_TAKEN_NOTICE);
  });

  it("does not throw when setPhone rejects", async () => {
    const h = harness([{ id: STAFF, phone: "+13055550100", accountType: "staff" }]);
    h.deps.setPhone = async () => {
      throw new Error("network down");
    };
    const result = await syncLoginPhone(
      { userId: STAFF, phone: "", previousPhone: "305-555-0100", source: "staff" },
      h.deps,
    );
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "error");
    assert.equal(result.notice, PHONE_SYNC_FAILED_NOTICE);
  });
});
