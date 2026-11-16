import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitSchedule, unpaidScheduleRows, type SchedRow } from "./scheduleLock.ts";

const schedule2500: SchedRow[] = [
  { id: "a", seq: 1, due_date: "2026-04-10", amount: 750, label: "Retainer" },
  { id: "b", seq: 2, due_date: "2027-02-23", amount: 875, label: "Second Payment" },
  { id: "c", seq: 3, due_date: "2027-03-25", amount: 875, label: "Final Payment" },
];

describe("splitSchedule / unpaidScheduleRows net actual payments", () => {
  it("covers earliest due rows with an unlinked $750 payment (Drew example)", () => {
    // total $2,500; one unlinked payment $750 on Apr 10 → upcoming $875 + $875 = $1,750
    const open = unpaidScheduleRows(schedule2500, [
      { amount: 750, scheduled_payment_id: null },
    ]);
    assert.deepEqual(
      open.map((r) => ({ id: r.id, amount: r.amount })),
      [
        { id: "b", amount: 875 },
        { id: "c", amount: 875 },
      ],
    );
    assert.equal(
      open.reduce((s, r) => s + r.amount, 0),
      1750,
    );

    const { locked, lockedSum, received } = splitSchedule(schedule2500, [{ amount: 750, scheduled_payment_id: null }], "due_date");
    assert.equal(received, 750);
    assert.equal(lockedSum, 750);
    assert.deepEqual(
      locked.map((r) => r.id),
      ["a"],
    );
  });

  it("does not require scheduled_payment_id for payments_save_schedule remaining math", () => {
    // Same unlinked payment: remaining target is total - lockedSum = 2500 - 750
    const { lockedSum, open } = splitSchedule(schedule2500, [{ amount: 750, scheduled_payment_id: null }], "seq");
    assert.equal(lockedSum, 750);
    assert.equal(2500 - lockedSum, 1750);
    assert.equal(
      open.reduce((s, r) => s + r.amount, 0),
      1750,
    );
  });

  it("still honors an explicit link even when cash alone would not cover the row", () => {
    const { locked } = splitSchedule(schedule2500, [{ amount: 100, scheduled_payment_id: "a" }], "seq");
    assert.deepEqual(
      locked.map((r) => r.id),
      ["a"],
    );
  });
});
