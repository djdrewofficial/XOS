import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOC_TYPES,
  defaultHeaderKicker,
  formatDocumentTitle,
  paymentReceiptInvoiceBlocks,
  sanitizeBlocks,
} from "./documentBlocks.ts";

describe("documentBlocks receipt helpers", () => {
  it("includes receipt in DOC_TYPES with Payment Receipt kicker", () => {
    assert.ok(DOC_TYPES.some(([v]) => v === "receipt"));
    assert.equal(defaultHeaderKicker("receipt"), "Payment Receipt");
    assert.equal(defaultHeaderKicker("contract"), "Booking Agreement");
  });

  it("formats titles with a plain hyphen by default (no em dash)", () => {
    const title = formatDocumentTitle(null, {
      template: "Payment Receipt",
      client: "Margie Weidman",
      event: "Weidman Wedding",
    });
    assert.equal(title, "Payment Receipt - Margie Weidman");
    assert.doesNotMatch(title, /—/);
  });

  it("honors an editable title_format", () => {
    assert.equal(
      formatDocumentTitle("{template} for {event}", {
        template: "Payment Receipt",
        client: "Margie Weidman",
        event: "Weidman Wedding",
      }),
      "Payment Receipt for Weidman Wedding",
    );
  });

  it("accepts payments_received and summary_box smart blocks with options", () => {
    const blocks = sanitizeBlocks([
      { id: "1", type: "payments_received", options: { showNotes: true } },
      { id: "2", type: "summary_box", options: { totalLabel: "Total investment" } },
      { id: "3", type: "fee_table", options: { showQty: true, showDescriptions: false, totalLabel: "Total Investment" } },
      { id: "4", type: "payment_schedule", options: { onlyUnpaid: true, hideWhenPaidInFull: true } },
      { id: "5", type: "signature" },
    ]);
    assert.equal(blocks.length, 5);
    assert.equal(blocks[0].type, "payments_received");
    assert.equal(blocks[0].options?.showNotes, true);
    assert.equal(blocks[1].type, "summary_box");
    assert.equal(blocks[1].options?.totalLabel, "Total investment");
    assert.equal(blocks[2].options?.showQty, true);
    assert.equal(blocks[3].options?.onlyUnpaid, true);
  });

  it("ships the recommended Payment Receipt invoice-style block config", () => {
    const blocks = paymentReceiptInvoiceBlocks();
    assert.equal(blocks.map((b) => b.type).join(","), "text,fee_table,payments_received,summary_box,payment_schedule");
    assert.equal(blocks[1].options?.showQty, true);
    assert.equal(blocks[2].options?.showNotes, false);
    assert.equal(blocks[4].options?.hideWhenPaidInFull, true);
  });
});
