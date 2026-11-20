import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyContractHolderMergeTags,
  pickContractHolder,
  pickPartnerB,
  pickPlanners,
  type ContractHolderMember,
} from "./contractHolder.ts";

const JORDYN = "11111111-1111-1111-1111-111111111111";
const JAMIE = "22222222-2222-2222-2222-222222222222";
const KELLI = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";

function m(partial: Partial<ContractHolderMember> & { clientId: string }): ContractHolderMember {
  return {
    firstName: partial.firstName ?? "First",
    lastName: partial.lastName ?? "Last",
    email: partial.email ?? null,
    phone: partial.phone ?? null,
    organization: partial.organization ?? null,
    role: partial.role ?? null,
    isPrimary: partial.isPrimary ?? false,
    isContractHolder: partial.isContractHolder ?? false,
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00Z",
    eventClientId: partial.eventClientId ?? null,
    clientId: partial.clientId,
  };
}

/** #500930-style: planner is primary; groom is holder with name only. */
const wedding = [
  m({
    clientId: JORDYN,
    firstName: "Jordyn",
    lastName: "Elyse",
    email: "jordyn@example.com",
    phone: "+15551110001",
    role: "Planner",
    isPrimary: true,
    isContractHolder: false,
    createdAt: "2026-01-01T00:00:00Z",
  }),
  m({
    clientId: JAMIE,
    firstName: "Jamie",
    lastName: "Beck",
    email: null,
    phone: null,
    role: "Groom",
    isPrimary: false,
    isContractHolder: true,
    createdAt: "2026-01-02T00:00:00Z",
  }),
  m({
    clientId: KELLI,
    firstName: "Kelli",
    lastName: "Beck",
    email: "kelli@example.com",
    role: "Bride",
    isPrimary: false,
    isContractHolder: false,
    createdAt: "2026-01-03T00:00:00Z",
  }),
];

describe("pickContractHolder", () => {
  it("picks the contract holder when primary is someone else", () => {
    const holder = pickContractHolder({ members: wedding, eventClientId: JORDYN });
    assert.equal(holder?.clientId, JAMIE);
    assert.equal(holder?.firstName, "Jamie");
  });

  it("falls back to events.client_id when no holder exists", () => {
    const members = wedding.map((row) => ({ ...row, isContractHolder: false }));
    const holder = pickContractHolder({ members, eventClientId: JORDYN });
    assert.equal(holder?.clientId, JORDYN);
  });

  it("with multiple holders prefers non-planner, then primary, then oldest", () => {
    const members = [
      m({
        clientId: JORDYN,
        firstName: "Jordyn",
        role: "Planner",
        isContractHolder: true,
        isPrimary: true,
        createdAt: "2026-01-01T00:00:00Z",
      }),
      m({
        clientId: JAMIE,
        firstName: "Jamie",
        role: "Groom",
        isContractHolder: true,
        isPrimary: false,
        createdAt: "2026-01-05T00:00:00Z",
      }),
      m({
        clientId: OTHER,
        firstName: "Older",
        role: "Client",
        isContractHolder: true,
        isPrimary: false,
        createdAt: "2026-01-02T00:00:00Z",
      }),
    ];
    // Non-planner preferred over planner-holder; among non-planners, primary none → oldest (OTHER)
    assert.equal(pickContractHolder({ members, eventClientId: JORDYN })?.clientId, OTHER);

    const withPrimaryHolder = members.map((row) =>
      row.clientId === JAMIE ? { ...row, isPrimary: true } : { ...row, isPrimary: false },
    );
    assert.equal(pickContractHolder({ members: withPrimaryHolder, eventClientId: JORDYN })?.clientId, JAMIE);
  });

  it("supports a holder who only has a name", () => {
    const holder = pickContractHolder({ members: wedding, eventClientId: JORDYN });
    assert.equal(holder?.email, null);
    assert.equal(holder?.phone, null);
    assert.equal(`${holder?.firstName} ${holder?.lastName}`.trim(), "Jamie Beck");
  });
});

describe("pickPartnerB and pickPlanners", () => {
  it("partner B skips holder and planners", () => {
    const holder = pickContractHolder({ members: wedding, eventClientId: JORDYN });
    const b = pickPartnerB(wedding, holder);
    assert.equal(b?.clientId, KELLI);
    const planners = pickPlanners(wedding, holder);
    assert.deepEqual(planners.map((p) => p.clientId), [JORDYN]);
  });
});

describe("applyContractHolderMergeTags", () => {
  it("fills unresolved client tags from the holder", () => {
    const html = applyContractHolderMergeTags("Hi <first_name> (<client_name>)", {
      firstName: "Jamie",
      lastName: "Beck",
      email: null,
      phone: null,
      organization: null,
    });
    assert.equal(html, "Hi Jamie (Jamie Beck)");
  });
});
