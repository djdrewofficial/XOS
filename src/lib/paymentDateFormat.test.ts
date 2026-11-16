import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCurrentDateNy, formatPaymentDate, isMidnightUtc } from "./paymentDateFormat.ts";

describe("paymentDateFormat", () => {
  it("keeps midnight-UTC paid_at on the UTC calendar date (no NY shift)", () => {
    // 2026-10-14T00:00:00Z is still Oct 13 evening in America/New_York
    assert.equal(isMidnightUtc("2026-10-14T00:00:00+00:00"), true);
    assert.equal(formatPaymentDate("2026-10-14T00:00:00+00:00"), "October 14, 2026");
    assert.equal(formatPaymentDate("2026-10-14T00:00:00.000Z"), "October 14, 2026");
  });

  it("formats non-midnight timestamps in America/New_York", () => {
    assert.equal(isMidnightUtc("2026-11-12T18:30:00Z"), false);
    assert.equal(formatPaymentDate("2026-11-12T18:30:00Z"), "November 12, 2026");
    // Late evening UTC can be previous calendar day in NY
    assert.equal(formatPaymentDate("2026-11-13T03:30:00Z"), "November 12, 2026");
  });

  it("formats current_date in America/New_York", () => {
    const fixed = new Date("2026-11-16T05:00:00Z"); // Nov 16 00:00 EST
    assert.equal(formatCurrentDateNy(fixed), "November 16, 2026");
  });
});
