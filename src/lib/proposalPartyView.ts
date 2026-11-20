/**
 * Exactly what the public proposal page shows for people:
 *   1) greeting first name
 *   2) "Prepared for" client name (under the event name)
 *   3) Your Information prefills
 *   4) Planner block
 *
 * All of (1)–(3) come from the contract holder (Partner 1), never from the
 * primary client when a holder exists. Pricing is unrelated.
 */

import {
  displayName,
  pickContractHolder,
  pickPartnerB,
  pickPlanners,
  type ContractHolderMember,
} from "@/lib/contractHolder";

export type ProposalContactFields = {
  first: string;
  last: string;
  email: string;
  phone: string;
  organization: string;
};

export type ProposalPlannerFields = {
  name: string;
  organization: string;
  email: string;
  phone: string;
};

export type ProposalPartyView = {
  greetingFirstName: string;
  preparedForName: string;
  yourInfo: ProposalContactFields;
  partner: ProposalContactFields | null;
  planners: ProposalPlannerFields[];
  holderClientId: string | null;
  partnerClientId: string | null;
};

function fieldsFrom(m: ContractHolderMember | null): ProposalContactFields {
  return {
    first: (m?.firstName ?? "").trim(),
    last: (m?.lastName ?? "").trim(),
    email: (m?.email ?? "").trim(),
    phone: (m?.phone ?? "").trim(),
    organization: (m?.organization ?? "").trim(),
  };
}

export function buildProposalPartyView(input: {
  members: ContractHolderMember[];
  eventClientId: string | null;
}): ProposalPartyView {
  const holder = pickContractHolder({
    members: input.members,
    eventClientId: input.eventClientId,
  });
  const partnerMember = pickPartnerB(input.members, holder);
  const planners = pickPlanners(input.members, holder);
  const yourInfo = fieldsFrom(holder);
  const partnerFields = fieldsFrom(partnerMember);
  const hasPartner =
    Boolean(partnerFields.first || partnerFields.last || partnerFields.email || partnerFields.phone);
  const preparedForName = displayName({
    firstName: yourInfo.first || null,
    lastName: yourInfo.last || null,
  });

  return {
    greetingFirstName: yourInfo.first || "there",
    preparedForName,
    yourInfo,
    partner: hasPartner ? partnerFields : null,
    planners: planners.map((p) => ({
      name: displayName(p),
      organization: (p.organization ?? "").trim(),
      email: (p.email ?? "").trim(),
      phone: (p.phone ?? "").trim(),
    })),
    holderClientId: holder?.clientId ?? null,
    partnerClientId: partnerMember?.clientId ?? null,
  };
}
