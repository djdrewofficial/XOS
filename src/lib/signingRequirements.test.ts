import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REQUIRED,
  eventFinancialsHidden,
  getMissingSigningFields,
  type SigningBundle,
} from "./signingRequirements.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function bundle(partial: Partial<SigningBundle> = {}): SigningBundle {
  return {
    event: { event_date: "2026-11-08", start_time: "16:00", end_time: "23:00", package_id: "pkg", venue_id: "ven" },
    venue: { name: "Villa Toscana Miami", address: "1 Toscana Way" },
    eventClients: [
      { is_primary: true, is_contract_holder: true, client: { first_name: "Stephanie", last_name: "Miles", email: "s@example.com" } },
      { is_primary: false, client: { first_name: "Davide", last_name: "Rossi", cell_phone: "3055550100" } },
    ],
    scheduleCount: 0,
    ...partial,
  };
}

describe("eventFinancialsHidden", () => {
  it("treats a Booked EV status flag as venue-paid", () => {
    assert.equal(eventFinancialsHidden({ hide_financials: null, status: { hide_financials: true } }), true);
  });

  it("treats a venue-paid package flag as venue-paid", () => {
    assert.equal(eventFinancialsHidden({ package: { hide_financials: true } }), true);
  });

  it("lets an explicit per-event false show financials even on Booked EV", () => {
    assert.equal(
      eventFinancialsHidden({ hide_financials: false, status: { hide_financials: true }, package: { hide_financials: true } }),
      false,
    );
  });

  it("lets an explicit per-event true hide financials with no other flag", () => {
    assert.equal(eventFinancialsHidden({ hide_financials: true }), true);
  });

  it("keeps a normal client-paid event visible", () => {
    assert.equal(
      eventFinancialsHidden({
        hide_financials: null,
        status: { hide_financials: false },
        package: { hide_financials: false },
        event_type: { hide_financials: false },
      }),
      false,
    );
  });
});

describe("payment schedule signing requirement", () => {
  it("does not flag Payment Schedule on a venue-paid event with no schedule", () => {
    const missing = getMissingSigningFields(DEFAULT_REQUIRED, bundle({ financialsHidden: true, scheduleCount: 0 }));
    assert.equal(missing.some((m) => m.key === "payment_schedule"), false);
  });

  it("still flags Payment Schedule on a client-paid event with no schedule", () => {
    const missing = getMissingSigningFields(DEFAULT_REQUIRED, bundle({ financialsHidden: false, scheduleCount: 0 }));
    assert.deepEqual(
      missing.map((m) => m.key),
      ["payment_schedule"],
    );
  });

  it("still flags other missing fields on a venue-paid event", () => {
    const missing = getMissingSigningFields(
      DEFAULT_REQUIRED,
      bundle({
        financialsHidden: true,
        scheduleCount: 0,
        event: { event_date: null, start_time: null, end_time: null, package_id: null, venue_id: null },
        venue: null,
        eventClients: [],
      }),
    );
    assert.equal(missing.some((m) => m.key === "payment_schedule"), false);
    assert.equal(missing.some((m) => m.key === "event_date"), true);
    assert.equal(missing.some((m) => m.key === "partner_b_name"), true);
  });

  it("does not flag Payment Schedule once a client-paid event has a schedule", () => {
    const missing = getMissingSigningFields(DEFAULT_REQUIRED, bundle({ scheduleCount: 2 }));
    assert.equal(missing.some((m) => m.key === "payment_schedule"), false);
  });
});

describe("other payment-schedule surfaces", () => {
  it("already skips a client schedule on venue-paid quotes, agreements, and payment emails", () => {
    const proposal = readFileSync(join(root, "src/app/proposal/[token]/actions.ts"), "utf8");
    const docs = readFileSync(join(root, "src/lib/documentRender.ts"), "utf8");
    const mail = readFileSync(join(root, "src/lib/signing.ts"), "utf8");
    // Proposal rebuild, the agreement block, and the payment-plan email already
    // follow event_financials_hidden. The event-page banner was the gap.
    assert.match(proposal, /bundle\?\.financialsHidden !== true/);
    assert.match(docs, /if \(b\.financialsHidden\) return ""/);
    assert.match(mail, /bundle\.financialsHidden \|\| !bundle\.schedule\.length/);
  });
});
