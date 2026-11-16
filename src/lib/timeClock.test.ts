import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPunchWithoutLocation,
  distanceMeters,
  effectiveHourlyRate,
  geofenceDecision,
  hoursFromPunches,
  hourlyAmount,
  isMissedPunch,
  nextPunchType,
  payableHoursFromPunches,
  punchPairs,
} from "./timeClock.ts";
import { staffCost, staffCostForPayroll, staffHours } from "./payroll.ts";

describe("timeClock distance and pairs", () => {
  it("computes haversine distance in meters", () => {
    const d = distanceMeters(25.7617, -80.1918, 25.7717, -80.1918);
    assert.ok(d != null && d > 1000 && d < 1200);
    assert.equal(distanceMeters(null, -80, 25, -80), null);
  });

  it("pairs in/out punches and ignores open trailing in", () => {
    const pairs = punchPairs([
      { punch_type: "in", punched_at: "2026-06-01T10:00:00Z" },
      { punch_type: "out", punched_at: "2026-06-01T12:00:00Z" },
      { punch_type: "in", punched_at: "2026-06-01T13:00:00Z" },
      { punch_type: "out", punched_at: "2026-06-01T14:30:00Z" },
      { punch_type: "in", punched_at: "2026-06-01T15:00:00Z" },
    ]);
    assert.equal(pairs.length, 2);
    assert.equal(hoursFromPunches([
      { punch_type: "in", punched_at: "2026-06-01T10:00:00Z" },
      { punch_type: "out", punched_at: "2026-06-01T12:00:00Z" },
      { punch_type: "in", punched_at: "2026-06-01T13:00:00Z" },
      { punch_type: "out", punched_at: "2026-06-01T14:30:00Z" },
    ]), 3.5);
  });

  it("defaults to no travel on punched hours", () => {
    const punches = [
      { punch_type: "in", punched_at: "2026-06-01T10:00:00Z" },
      { punch_type: "out", punched_at: "2026-06-01T12:00:00Z" },
    ];
    assert.equal(payableHoursFromPunches(punches, { include_travel_for_hourly_punches: false }, 30), 2);
    assert.equal(payableHoursFromPunches(punches, { include_travel_for_hourly_punches: true }, 30), 3);
  });

  it("next punch type toggles with open shift", () => {
    assert.equal(nextPunchType([]), "in");
    assert.equal(nextPunchType([{ punch_type: "in", punched_at: "2026-06-01T10:00:00Z" }]), "out");
    assert.equal(
      nextPunchType([
        { punch_type: "in", punched_at: "2026-06-01T10:00:00Z" },
        { punch_type: "out", punched_at: "2026-06-01T12:00:00Z" },
      ]),
      "in"
    );
  });
});

describe("timeClock settings helpers", () => {
  it("allows missing location by default", () => {
    assert.equal(canPunchWithoutLocation(null), true);
    assert.equal(canPunchWithoutLocation({ allow_punch_without_location: false }), false);
  });

  it("keeps geofence off by default", () => {
    assert.deepEqual(geofenceDecision({ geofence_enabled: false }, 5000), { ok: true, block: false, warn: false });
    assert.equal(geofenceDecision({ geofence_enabled: true, geofence_mode: "block", geofence_radius_m: 200 }, 500).block, true);
  });

  it("uses assignment override over employee rate", () => {
    assert.equal(effectiveHourlyRate({ hourly_rate_override: 25 }, { hourly_rate: 40 }), 25);
    assert.equal(effectiveHourlyRate({}, { hourly_rate: 40 }), 40);
    assert.equal(hourlyAmount(2.5, 25), 62.5);
  });

  it("flags missed punches after grace", () => {
    const now = new Date("2026-06-01T18:00:00Z");
    assert.equal(
      isMissedPunch({ eventDate: "2026-06-01", startTime: "10:00", graceMinutes: 30, hasInPunch: false, now }),
      true
    );
    assert.equal(
      isMissedPunch({ eventDate: "2026-06-01", startTime: "10:00", graceMinutes: 30, hasInPunch: true, now }),
      false
    );
  });
});

describe("payroll prefers locked hourly amounts", () => {
  it("skips unapproved hourly for payroll", () => {
    const es = { pay_type: "hourly", timesheet_status: "open", flat_wage: 0 };
    assert.equal(staffCostForPayroll(es, { hourly_rate: 25 }, 4), null);
    assert.equal(
      staffCostForPayroll({ ...es, timesheet_status: "locked", timesheet_amount: 100 }, { hourly_rate: 25 }, 4),
      100
    );
  });

  it("does not add travel for punched hourly when setting is off", () => {
    const es = {
      pay_type: "hourly",
      checked_in_at: "2026-06-01T10:00:00Z",
      checked_out_at: "2026-06-01T12:00:00Z",
    };
    const hours = staffHours(es, {}, 30, {
      actual: true,
      punchedHourly: true,
      settings: { include_travel_for_hourly_punches: false },
    });
    assert.equal(hours, 2);
    assert.equal(staffCost(es, { hourly_rate: 25 }, hours), 50);
  });
});
