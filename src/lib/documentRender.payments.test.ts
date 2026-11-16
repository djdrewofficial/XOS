import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderPaymentsReceived, type EventBundle } from "./documentRender.ts";

function bundle(partial: Partial<EventBundle> & Pick<EventBundle, "payments" | "total" | "financialsHidden">): EventBundle {
  return {
    event: {
      id: "e1",
      name: "Sample",
      event_date: "2026-08-15",
      setup_time: null,
      start_time: null,
      end_time: null,
      guest_count: 100,
      package_id: null,
      package_price_override: null,
      package_price_locked: null,
      package_version_no: null,
      overtime_fee: 0,
      travel_fee: 0,
      discount1_label: null,
      discount1_amount: 0,
      discount2_label: null,
      discount2_amount: 0,
      client: null,
      venue: null,
      package: null,
      event_type: null,
    },
    addons: [],
    schedule: [],
    pinnedDescription: null,
    contractNotes: [],
    ...partial,
  };
}

describe("renderPaymentsReceived", () => {
  it("hides money when event_financials_hidden", () => {
    const html = renderPaymentsReceived(
      bundle({
        financialsHidden: true,
        total: 1000,
        payments: [{ amount: 100, method: "zelle", paidAt: "2026-10-14T00:00:00Z" }],
      }),
    );
    assert.equal(html, "");
  });

  it("lists payments, shows card fee separately, and Paid in full when settled", () => {
    const html = renderPaymentsReceived(
      bundle({
        financialsHidden: false,
        total: 1250,
        payments: [
          { amount: 200, method: "zelle", paidAt: "2026-10-14T00:00:00+00:00", reason: "Retainer" },
          {
            amount: 1050,
            method: "paypal",
            paidAt: "2026-11-12T18:30:00Z",
            processingFee: 42,
            notes: "Capture ABC",
          },
        ],
      }),
    );
    assert.match(html, /October 14, 2026/);
    assert.match(html, /November 12, 2026/);
    assert.match(html, /Card service fee: \$42\.00/);
    assert.match(html, /Paid in full/);
    assert.doesNotMatch(html, /\$1,292/); // fee must not inflate paid total
    assert.doesNotMatch(html, /—/);
  });
});
