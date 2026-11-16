import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fmtDate,
  renderFeeTable,
  renderPaymentSchedule,
  renderPaymentsReceived,
  renderSummaryBox,
  unpaidScheduleRows,
  type EventBundle,
} from "./documentRender.ts";
import { XDOC_CSS } from "./documentShellCss.ts";
import type { ReceiptPayment } from "./paymentReceiptMerge.ts";

function bundle(
  partial: Partial<EventBundle> & Pick<EventBundle, "payments" | "total" | "financialsHidden">,
): EventBundle {
  return {
    event: {
      id: "e1",
      name: "Sample Wedding",
      event_date: "2026-08-15",
      setup_time: null,
      start_time: null,
      end_time: null,
      guest_count: 100,
      package_id: "pkg1",
      package_price_override: null,
      package_price_locked: 2450,
      package_version_no: 1,
      overtime_fee: 0,
      travel_fee: 150,
      discount1_label: "Early booking",
      discount1_amount: 100,
      discount2_label: null,
      discount2_amount: 0,
      client: { first_name: "Margie", last_name: "Weidman", email: "m@example.com" },
      venue: { name: "Villa Toscana", address: "1 Main", city: "Miami", state: "FL", setup_fee: 0 },
      package: {
        name: "The Xperience",
        client_facing_name: "The Xperience Package",
        default_price: 2450,
        description: "Full service DJ",
      },
      event_type: { name: "Wedding" },
    },
    addons: [
      {
        quantity: 2,
        price_override: null,
        price_locked: 100,
        description_override: null,
        addon: {
          name: "Uplighting",
          client_facing_name: "LED Uplighting",
          description: "Wireless LED cans",
          default_price: 100,
        },
      },
    ],
    schedule: [
      { id: "sp1", seq: 1, due_date: "2026-01-15", amount: 500, label: "Retainer" },
      { id: "sp2", seq: 2, due_date: "2026-06-01", amount: 1000, label: "Second Payment" },
      { id: "sp3", seq: 3, due_date: "2026-08-01", amount: 1200, label: "Final Payment" },
    ],
    pinnedDescription: "Full service DJ",
    contractNotes: [],
    ...partial,
  };
}

const partialPay: ReceiptPayment[] = [
  { amount: 500, method: "zelle", paidAt: "2026-01-15T00:00:00Z", reason: "Retainer", scheduledPaymentId: "sp1" },
];

const fullPay: ReceiptPayment[] = [
  ...partialPay,
  { amount: 1000, method: "check", paidAt: "2026-06-01T00:00:00Z", scheduledPaymentId: "sp2" },
  {
    amount: 1200,
    method: "paypal",
    paidAt: "2026-07-20T18:00:00Z",
    processingFee: 40,
    notes: "PayPal capture CAP-ABC123",
    scheduledPaymentId: "sp3",
  },
];

describe("fmtDate date-only", () => {
  it("does not shift a YYYY-MM-DD due date across timezones", () => {
    assert.equal(fmtDate("2026-08-01"), "Saturday, August 1, 2026");
    assert.equal(fmtDate("2026-08-01T23:00:00.000Z"), "Saturday, August 1, 2026");
  });
});

describe("renderFeeTable options", () => {
  it("supports qty columns, descriptions, heading, and a custom total label", () => {
    const html = renderFeeTable(
      bundle({ financialsHidden: false, total: 2700, payments: [] }),
      { heading: "Line Items", showDescriptions: true, showQty: true, totalLabel: "Total Investment" },
    );
    assert.match(html, /Line Items/);
    assert.match(html, /Qty/);
    assert.match(html, /Unit Price/);
    assert.match(html, /LED Uplighting/);
    assert.match(html, /Wireless LED cans/);
    assert.match(html, />2</);
    assert.doesNotMatch(html, /LED Uplighting × 2/); // qty is its own column
    assert.match(html, /Travel Fee/);
    assert.match(html, /Early booking/);
    assert.match(html, /Total Investment/);
    assert.doesNotMatch(html, /—/);
  });

  it("can hide descriptions", () => {
    const html = renderFeeTable(
      bundle({ financialsHidden: false, total: 2700, payments: [] }),
      { showDescriptions: false, showQty: false },
    );
    assert.doesNotMatch(html, /Wireless LED cans/);
    assert.doesNotMatch(html, /Full service DJ/);
  });

  it("lists services without money when financials are hidden", () => {
    const html = renderFeeTable(
      bundle({ financialsHidden: true, total: 2700, payments: partialPay }),
      { showQty: true, showDescriptions: true },
    );
    assert.match(html, /The Xperience Package/);
    assert.doesNotMatch(html, /\$2,450/);
    assert.doesNotMatch(html, /Total Investment/);
  });
});

describe("renderPaymentsReceived notes option", () => {
  it("hides notes/reason/bank-ref entirely when showNotes is off (default)", () => {
    const html = renderPaymentsReceived(
      bundle({
        financialsHidden: false,
        total: 2700,
        payments: [
          {
            amount: 500,
            method: "zelle",
            paidAt: "2026-01-15T00:00:00Z",
            reason: "Retainer",
            notes: "",
            bankDepositRef: "DEP-99",
          },
        ],
      }),
    );
    assert.doesNotMatch(html, /<th>Notes<\/th>/);
    assert.doesNotMatch(html, /Retainer/);
    assert.doesNotMatch(html, /DEP-99/);
    assert.match(html, /<th>Date<\/th>/);
  });

  it("shows notes when enabled but never reason fallback or import noise", () => {
    const html = renderPaymentsReceived(
      bundle({
        financialsHidden: false,
        total: 2700,
        payments: [
          {
            amount: 500,
            method: "zelle",
            paidAt: "2026-01-15T00:00:00Z",
            reason: "Retainer",
            notes: "Thanks!",
          },
          {
            amount: 200,
            method: "paypal",
            paidAt: "2026-02-01T00:00:00Z",
            notes: "PayPal capture CAP-ZZZ999",
            reason: "Final",
            legacyDjepId: "djep-1",
          },
          {
            amount: 100,
            method: "cash",
            paidAt: "2026-03-01T00:00:00Z",
            notes: "",
            reason: "ShouldNotPrint",
            bankDepositRef: "BANK-1",
          },
        ],
      }),
      { showNotes: true, heading: "Payments Received" },
    );
    assert.match(html, /Payments Received/);
    assert.match(html, /<th>Notes<\/th>/);
    assert.match(html, /Thanks!/);
    assert.doesNotMatch(html, /CAP-ZZZ999/);
    assert.doesNotMatch(html, /ShouldNotPrint/);
    assert.doesNotMatch(html, /BANK-1/);
    // reason is not a notes fallback, but "Retainer" must not appear from the notes cell
    assert.doesNotMatch(html, /<td>Retainer<\/td>/);
  });

  it("returns empty when financials are hidden", () => {
    assert.equal(
      renderPaymentsReceived(bundle({ financialsHidden: true, total: 2700, payments: partialPay }), {
        heading: "Payments Received",
      }),
      "",
    );
  });
});

describe("renderSummaryBox", () => {
  it("shows balance due or paid in full with editable labels", () => {
    const open = renderSummaryBox(
      bundle({ financialsHidden: false, total: 2700, payments: partialPay }),
      { totalLabel: "Total investment", paidLabel: "Already paid", balanceLabel: "Balance due" },
    );
    assert.match(open, /xdoc-summary/);
    assert.match(open, /Total investment/);
    assert.match(open, /Already paid/);
    assert.match(open, /Balance due/);
    assert.match(open, /\$2,200\.00/);

    const settled = renderSummaryBox(
      bundle({ financialsHidden: false, total: 2700, payments: fullPay }),
      { paidInFullLabel: "Paid in full" },
    );
    assert.match(settled, /Paid in full/);
    assert.doesNotMatch(settled, /Balance due/);
  });

  it("hides entirely (labels and heading too) when financials are hidden", () => {
    assert.equal(
      renderSummaryBox(bundle({ financialsHidden: true, total: 2700, payments: [] }), {
        heading: "Summary",
        totalLabel: "Total investment",
        paidLabel: "Already paid",
      }),
      "",
    );
  });
});

describe("renderPaymentSchedule options", () => {
  it("shows only remaining rows after applying payments in due-date order", () => {
    const unpaid = renderPaymentSchedule(
      bundle({ financialsHidden: false, total: 2700, payments: partialPay }),
      { onlyUnpaid: true, heading: "Upcoming Payments" },
    );
    assert.match(unpaid, /Upcoming Payments/);
    assert.match(unpaid, /Second Payment/);
    assert.match(unpaid, /Final Payment/);
    assert.doesNotMatch(unpaid, /Retainer/);
    assert.match(unpaid, /August 1, 2026/);

    // due date order, not seq: earlier due date with higher seq is covered first
    const byDue = unpaidScheduleRows(
      [
        { id: "late", seq: 1, due_date: "2026-08-01", amount: 500, label: "Late label early seq" },
        { id: "early", seq: 2, due_date: "2026-01-15", amount: 500, label: "Early due" },
        { id: "mid", seq: 3, due_date: "2026-06-01", amount: 500, label: "Mid due" },
      ],
      [{ amount: 500, method: "zelle", paidAt: "2026-01-15T00:00:00Z" }],
    );
    assert.deepEqual(
      byDue.map((r) => r.id),
      ["mid", "late"],
    );

    const hidden = renderPaymentSchedule(
      bundle({ financialsHidden: false, total: 2700, payments: fullPay }),
      { onlyUnpaid: true, hideWhenPaidInFull: true, heading: "Upcoming Payments" },
    );
    assert.equal(hidden, "");
  });

  it("returns empty when financials are hidden", () => {
    assert.equal(
      renderPaymentSchedule(bundle({ financialsHidden: true, total: 2700, payments: [] }), {
        onlyUnpaid: true,
        heading: "Upcoming Payments",
      }),
      "",
    );
  });
});

describe("PDF print CSS for money tables", () => {
  it("allows tables to split across pages with repeating headers and keeps footer attached", () => {
    assert.match(XDOC_CSS, /\.xdoc-table \{[^}]*break-inside: auto/);
    assert.match(XDOC_CSS, /thead \{ display: table-header-group/);
    assert.match(XDOC_CSS, /\.xdoc-footer \{[^}]*break-before: avoid/);
    assert.doesNotMatch(XDOC_CSS, /\.xdoc-table, .xdoc-details/);
  });
});
