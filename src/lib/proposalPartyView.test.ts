import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContractHolderMember } from "./contractHolder.ts";
import { buildProposalPartyView } from "./proposalPartyView.ts";

const JORDYN = "09d27475-48aa-4d5b-beed-623de1b0bc6f";
const JAMIE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const KELLI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

/** Live #500930 shape: planner primary; groom holder (name only); bride partner. */
const event500930: ContractHolderMember[] = [
  {
    clientId: JORDYN,
    firstName: "Jordyn",
    lastName: "Elyse",
    email: "elyse.events@outlook.com",
    phone: "+19546873649",
    organization: "Elyse Events",
    role: "Planner",
    isPrimary: true,
    isContractHolder: false,
    createdAt: "2026-11-20T17:06:17.834401+00",
  },
  {
    clientId: JAMIE,
    firstName: "Jamie",
    lastName: "Beck",
    email: null,
    phone: null,
    organization: null,
    role: "Groom",
    isPrimary: false,
    isContractHolder: true,
    createdAt: "2026-11-20T22:29:59.559071+00",
  },
  {
    clientId: KELLI,
    firstName: "Kelli",
    lastName: "",
    email: null,
    phone: null,
    organization: null,
    role: "Bride",
    isPrimary: false,
    isContractHolder: false,
    createdAt: "2026-11-20T22:30:10.000000+00",
  },
];

describe("buildProposalPartyView — #500930 screenshot spots", () => {
  it("greeting, Prepared for, and Your Info use Jamie (holder), not Jordyn (primary)", () => {
    const view = buildProposalPartyView({ members: event500930, eventClientId: JORDYN });

    // (1) "You're almost there, Jamie!"
    assert.equal(view.greetingFirstName, "Jamie");
    assert.notEqual(view.greetingFirstName, "Jordyn");

    // (2) name under Prepared for
    assert.equal(view.preparedForName, "Jamie Beck");
    assert.notEqual(view.preparedForName, "Jordyn Elyse");

    // (3) Your Information prefills from holder — blank email/phone stay empty strings
    // (the form must still render empty inputs for them)
    assert.equal(view.yourInfo.first, "Jamie");
    assert.equal(view.yourInfo.last, "Beck");
    assert.equal(view.yourInfo.email, "");
    assert.equal(view.yourInfo.phone, "");
    assert.equal(view.holderClientId, JAMIE);
  });

  it("shows Kelli as Partner 2 and Jordyn only in the Planner block", () => {
    const view = buildProposalPartyView({ members: event500930, eventClientId: JORDYN });
    assert.ok(view.partner);
    assert.equal(view.partner?.first, "Kelli");
    assert.equal(view.partnerClientId, KELLI);
    assert.equal(view.planners.length, 1);
    assert.equal(view.planners[0].name, "Jordyn Elyse");
    assert.equal(view.planners[0].organization, "Elyse Events");
    assert.equal(view.planners[0].email, "elyse.events@outlook.com");
  });
});
