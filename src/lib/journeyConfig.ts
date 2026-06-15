// Per-event-type "workflow" config for the /proposal confirm flow. Each event
// type can override a global default (null = inherit), mirroring the
// signing-requirements pattern in src/lib/signingRequirements.ts.

import type { SchedulePlan } from "@/lib/paymentSchedule";

export type ProposalLayout = "couple" | "business";
export type PaymentChooser = "client" | "office";
export type BillingTerms = "up_front" | "net_30" | "installments";

export const DEFAULT_LAYOUT: ProposalLayout = "couple";
export const DEFAULT_CHOOSER: PaymentChooser = "client";

export type JourneyOverride = {
  proposal_doc_template_id?: string | null;
  proposal_layout?: string | null;
  payment_chooser?: string | null;
};

export type JourneyResolved = {
  templateId: string | null;
  layout: ProposalLayout;
  chooser: PaymentChooser;
};

/** Per-type override wins, then the global default, then the built-in default. */
export function resolveJourney(
  type: JourneyOverride | null | undefined,
  global: JourneyOverride | null | undefined
): JourneyResolved {
  const layout = (type?.proposal_layout ?? global?.proposal_layout ?? DEFAULT_LAYOUT) as ProposalLayout;
  const chooser = (type?.payment_chooser ?? global?.payment_chooser ?? DEFAULT_CHOOSER) as PaymentChooser;
  return {
    templateId: type?.proposal_doc_template_id ?? global?.proposal_doc_template_id ?? null,
    layout: layout === "business" ? "business" : "couple",
    chooser: chooser === "office" ? "office" : "client",
  };
}

/** Maps the office-selected billing terms to a schedule plan. */
export function officePlan(terms: BillingTerms | null | undefined, count: number): SchedulePlan {
  if (terms === "net_30") return { kind: "net", days: 30 };
  if (terms === "installments") return { kind: "split", count: Math.max(1, count || 1) };
  return { kind: "full" }; // up_front (and fallback)
}
