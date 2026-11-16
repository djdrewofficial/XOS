import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOC_TYPES,
  defaultHeaderKicker,
  formatDocumentTitle,
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

  it("accepts payments_received smart blocks", () => {
    const blocks = sanitizeBlocks([
      { id: "1", type: "payments_received" },
      { id: "2", type: "signature" },
    ]);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, "payments_received");
  });
});
