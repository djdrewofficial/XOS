import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveOvertimeHourly, updateEventFinancialsRecord } from "./eventFinancials.ts";

describe("effectiveOvertimeHourly", () => {
  it("uses the event override when set", () => {
    assert.equal(effectiveOvertimeHourly(275, 250), 275);
    assert.equal(effectiveOvertimeHourly(0, 250), 0);
    assert.equal(effectiveOvertimeHourly("180.5", 250), 180.5);
  });

  it("falls back to the package default when the event override is null/undefined/blank", () => {
    assert.equal(effectiveOvertimeHourly(null, 250), 250);
    assert.equal(effectiveOvertimeHourly(undefined, 366), 366);
    assert.equal(effectiveOvertimeHourly("", 550), 550);
    assert.equal(effectiveOvertimeHourly(null, "125"), 125);
  });

  it("returns 0 when neither override nor package default is set", () => {
    assert.equal(effectiveOvertimeHourly(null, null), 0);
    assert.equal(effectiveOvertimeHourly(undefined, undefined), 0);
    assert.equal(effectiveOvertimeHourly(null, "nope"), 0);
  });
});

type Patch = Record<string, unknown>;

function fakeSupabase(opts: {
  packageId?: string | null;
  onUpdate?: (patch: Patch) => void;
}) {
  const eventId = "11111111-1111-1111-1111-111111111111";
  const pkgId = opts.packageId ?? "22222222-2222-2222-2222-222222222222";
  const client = {
    from(table: string) {
      if (table === "events") {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return { data: { package_id: pkgId, event_date: "2026-06-01", venue_id: null }, error: null };
                  },
                };
              },
            };
          },
          update(patch: Patch) {
            return {
              eq(col: string, id: string) {
                assert.equal(col, "id");
                assert.equal(id, eventId);
                opts.onUpdate?.(patch);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "packages") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: { default_price: 2450 }, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "event_addons") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, eventId };
}

describe("updateEventFinancialsRecord overtime_hourly", () => {
  const base = {
    packageId: "22222222-2222-2222-2222-222222222222",
    packagePriceOverride: null as number | null,
    overrideSubmitted: false,
    deposit: 500,
    overtime: 0,
    travel: 0,
    discount1: 0,
    discount2: 0,
  };

  it("writes overtime_hourly when provided as a number", async () => {
    let patch: Patch | null = null;
    const { client, eventId } = fakeSupabase({ onUpdate: (p) => { patch = p; } });
    await updateEventFinancialsRecord(client, eventId, {
      ...base,
      overtimeHourlyProvided: true,
      overtimeHourly: 300,
    });
    assert.equal(patch!.overtime_hourly, 300);
  });

  it("clears overtime_hourly when provided as null", async () => {
    let patch: Patch | null = null;
    const { client, eventId } = fakeSupabase({ onUpdate: (p) => { patch = p; } });
    await updateEventFinancialsRecord(client, eventId, {
      ...base,
      overtimeHourlyProvided: true,
      overtimeHourly: null,
    });
    assert.equal(patch!.overtime_hourly, null);
  });

  it("leaves overtime_hourly unchanged when not provided", async () => {
    let patch: Patch | null = null;
    const { client, eventId } = fakeSupabase({ onUpdate: (p) => { patch = p; } });
    await updateEventFinancialsRecord(client, eventId, base);
    assert.equal("overtime_hourly" in patch!, false);
  });
});
