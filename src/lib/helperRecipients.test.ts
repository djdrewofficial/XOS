import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRecipientOverride,
  parseRecipientConfig,
  resolveHelperRecipients,
  selectContactsForConfig,
  summarizeRecipientConfig,
  actionNeedsRecipientMigration,
  uniqueContacts,
  type EventContact,
} from "./helperRecipients.ts";

const PRIMARY = "11111111-1111-1111-1111-111111111111";
const HOLDER = "22222222-2222-2222-2222-222222222222";
const PLANNER = "33333333-3333-3333-3333-333333333333";
const DUP = "44444444-4444-4444-4444-444444444444";

function contact(partial: Partial<EventContact> & { clientId: string }): EventContact {
  return {
    firstName: partial.firstName ?? "First",
    lastName: partial.lastName ?? "Last",
    email: partial.email ?? null,
    phone: partial.phone ?? null,
    role: partial.role ?? null,
    isPrimary: partial.isPrimary ?? false,
    isContractHolder: partial.isContractHolder ?? false,
    eventClientId: partial.eventClientId ?? null,
    clientId: partial.clientId,
  };
}

/** Kelli & Jamie style: primary planner has email; contract holder has none. */
const weddingContacts: EventContact[] = [
  contact({
    clientId: PLANNER,
    firstName: "Jordyn",
    lastName: "Elyse",
    email: "jordyn@example.com",
    phone: "+15551110001",
    role: "Planner",
    isPrimary: true,
    isContractHolder: false,
  }),
  contact({
    clientId: HOLDER,
    firstName: "Jamie",
    lastName: "Beck",
    email: null,
    phone: "+15551110002",
    role: "Contract Holder",
    isPrimary: false,
    isContractHolder: true,
  }),
  contact({
    clientId: PRIMARY,
    firstName: "Kelli",
    lastName: "Beck",
    email: "kelli@example.com",
    phone: null,
    role: "Bride",
    isPrimary: false,
    isContractHolder: false,
  }),
];

describe("parseRecipientConfig", () => {
  it("defaults missing/invalid config to default mode", () => {
    assert.deepEqual(parseRecipientConfig(null), { mode: "default" });
    assert.deepEqual(parseRecipientConfig({ mode: "nope" }), { mode: "default" });
    assert.equal(parseRecipientConfig({ mode: "roles", roles: ["planner", ""] }).roles?.length, 1);
  });
});

describe("selectContactsForConfig", () => {
  it("default and primary pick the primary client only", () => {
    const def = selectContactsForConfig(weddingContacts, { mode: "default" });
    assert.deepEqual(def.map((c) => c.clientId), [PLANNER]);
    const primary = selectContactsForConfig(weddingContacts, { mode: "primary" });
    assert.deepEqual(primary.map((c) => c.clientId), [PLANNER]);
  });

  it("all returns every contact once", () => {
    const all = selectContactsForConfig(weddingContacts, { mode: "all" });
    assert.equal(all.length, 3);
  });

  it("contract_holder picks the holder and does not fall back to primary", () => {
    const holders = selectContactsForConfig(weddingContacts, { mode: "contract_holder" });
    assert.deepEqual(holders.map((c) => c.clientId), [HOLDER]);
    const none = selectContactsForConfig(
      weddingContacts.map((c) => ({ ...c, isContractHolder: false })),
      { mode: "contract_holder" },
    );
    assert.equal(none.length, 0);
  });

  it("roles can target planner and contract holder together", () => {
    const picked = selectContactsForConfig(weddingContacts, {
      mode: "roles",
      roles: ["planner", "contract_holder"],
    });
    assert.deepEqual(
      picked.map((c) => c.clientId).sort(),
      [HOLDER, PLANNER].sort(),
    );
  });

  it("dedupes when a contact matches multiple roles", () => {
    const contacts = [
      contact({
        clientId: PRIMARY,
        isPrimary: true,
        isContractHolder: true,
        role: "Bride",
        email: "a@example.com",
      }),
    ];
    const picked = selectContactsForConfig(contacts, {
      mode: "roles",
      roles: ["primary", "contract_holder", "bride"],
    });
    assert.equal(picked.length, 1);
    assert.ok(picked[0].matchedBy.includes("primary"));
    assert.ok(picked[0].matchedBy.includes("contract_holder"));
    assert.ok(picked[0].matchedBy.includes("bride"));
  });
});

describe("resolveHelperRecipients — email channel", () => {
  it("default mode emails the primary even when contract holder has no email", () => {
    const res = resolveHelperRecipients({
      contacts: weddingContacts,
      config: { mode: "default" },
      channel: "email",
    });
    assert.deepEqual(res.selected.map((c) => c.clientId), [PLANNER]);
    assert.equal(res.missingChannel.length, 0);
    assert.equal(res.warnings.length, 0);
  });

  it("contract_holder with no email is skipped with a visible warning (no silent primary fallback)", () => {
    const res = resolveHelperRecipients({
      contacts: weddingContacts,
      config: { mode: "contract_holder" },
      channel: "email",
    });
    assert.equal(res.selected.length, 0);
    assert.equal(res.missingChannel.length, 1);
    assert.equal(res.missingChannel[0].clientId, HOLDER);
    assert.match(res.warnings[0], /Jamie Beck.*no email/i);
  });

  it("primary client differs from contract holder: primary mode uses primary's email", () => {
    const res = resolveHelperRecipients({
      contacts: weddingContacts,
      config: { mode: "primary" },
      channel: "email",
    });
    assert.deepEqual(res.selected.map((c) => c.email), ["jordyn@example.com"]);
  });

  it("all mode skips contacts missing email and keeps the rest", () => {
    const res = resolveHelperRecipients({
      contacts: weddingContacts,
      config: { mode: "all" },
      channel: "email",
    });
    assert.deepEqual(
      res.selected.map((c) => c.clientId).sort(),
      [PLANNER, PRIMARY].sort(),
    );
    assert.equal(res.missingChannel.length, 1);
    assert.equal(res.missingChannel[0].clientId, HOLDER);
    assert.equal(res.warnings.length, 1);
  });

  it("staff override can send only to the planner (not the holder)", () => {
    const res = resolveHelperRecipients({
      contacts: weddingContacts,
      config: { mode: "contract_holder" },
      overrideClientIds: [PLANNER],
      channel: "email",
    });
    assert.deepEqual(res.selected.map((c) => c.clientId), [PLANNER]);
  });

  it("empty staff override sends to nobody and warns", () => {
    const res = resolveHelperRecipients({
      contacts: weddingContacts,
      config: { mode: "all" },
      overrideClientIds: [],
      channel: "email",
    });
    assert.equal(res.selected.length, 0);
    assert.ok(res.warnings.some((w) => /no contacts matched/i.test(w)));
  });
});

describe("resolveHelperRecipients — SMS channel", () => {
  it("skips contacts without a phone and warns", () => {
    const res = resolveHelperRecipients({
      contacts: weddingContacts,
      config: { mode: "all" },
      channel: "sms",
    });
    assert.deepEqual(
      res.selected.map((c) => c.clientId).sort(),
      [HOLDER, PLANNER].sort(),
    );
    assert.equal(res.missingChannel[0].clientId, PRIMARY);
    assert.match(res.warnings[0], /Kelli Beck.*no phone/i);
  });

  it("SMS without phone on the only target yields empty send + warning", () => {
    const res = resolveHelperRecipients({
      contacts: weddingContacts,
      config: { mode: "roles", roles: ["bride"] },
      channel: "sms",
    });
    assert.equal(res.selected.length, 0);
    assert.equal(res.missingChannel.length, 1);
  });
});

describe("duplicate contacts", () => {
  it("uniqueContacts collapses duplicate client ids", () => {
    const duped = [
      ...weddingContacts,
      contact({ clientId: PLANNER, firstName: "Jordyn", email: "other@example.com", isPrimary: true }),
    ];
    assert.equal(uniqueContacts(duped).length, 3);
  });

  it("override list with duplicate ids only includes the contact once", () => {
    const base = selectContactsForConfig(weddingContacts, { mode: "all" });
    const overridden = applyRecipientOverride(weddingContacts, base, [PLANNER, PLANNER, HOLDER]);
    assert.deepEqual(overridden.map((c) => c.clientId), [PLANNER, HOLDER]);
  });

  it("roles matching the same person twice still returns one row", () => {
    const contacts = [
      contact({
        clientId: DUP,
        firstName: "Alex",
        email: "alex@example.com",
        phone: "+15550001111",
        role: "Planner",
        isPrimary: true,
        isContractHolder: true,
      }),
    ];
    const res = resolveHelperRecipients({
      contacts,
      config: { mode: "roles", roles: ["primary", "contract_holder", "planner"] },
      channel: "email",
    });
    assert.equal(res.selected.length, 1);
  });
});

describe("helpers", () => {
  it("actionNeedsRecipientMigration is false for default/custom and true for non-default", () => {
    assert.equal(actionNeedsRecipientMigration({ type: "send_email", to: "client" }), false);
    assert.equal(
      actionNeedsRecipientMigration({
        type: "send_email",
        to: "client",
        recipients: { mode: "default" },
      }),
      false,
    );
    assert.equal(
      actionNeedsRecipientMigration({
        type: "send_email",
        to: "client",
        recipients: { mode: "all" },
      }),
      true,
    );
    assert.equal(
      actionNeedsRecipientMigration({
        type: "send_email",
        to: "custom",
        recipients: { mode: "all" },
      }),
      false,
    );
  });

  it("summarizeRecipientConfig is plain language", () => {
    assert.match(summarizeRecipientConfig({ mode: "default" }), /primary client \(default\)/i);
    assert.match(summarizeRecipientConfig({ mode: "roles", roles: ["planner"] }), /planner/i);
  });
});
