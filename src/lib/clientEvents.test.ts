import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareEventDateDesc, mergeClientEvents } from "./clientEvents.ts";

type Ev = {
  id: string;
  name: string;
  event_date: string | null;
  archived_at?: string | null;
};

function ev(partial: Partial<Ev> & Pick<Ev, "id">): Ev {
  return {
    name: partial.name ?? partial.id,
    event_date: partial.event_date ?? null,
    archived_at: partial.archived_at ?? null,
    ...partial,
  };
}

describe("mergeClientEvents", () => {
  it("returns primary events when there are no join links", () => {
    const primary = [ev({ id: "a", event_date: "2026-06-01" }), ev({ id: "b", event_date: "2025-01-01" })];
    const merged = mergeClientEvents(primary, []);
    assert.deepEqual(
      merged.map((e) => e.id),
      ["a", "b"],
    );
    assert.equal(merged[0].client_role, null);
  });

  it("includes events reached only via event_clients (co-client / contract holder)", () => {
    // Mia is on event_clients; events.client_id is the planner — not Mia.
    const primary: Ev[] = [];
    const links = [
      {
        role: "Bride",
        event: ev({ id: "500784", name: "Fusca Wedding", event_date: "2026-09-12" }),
      },
    ];
    const merged = mergeClientEvents(primary, links);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "500784");
    assert.equal(merged[0].client_role, "Bride");
  });

  it("dedupes when the same event is both primary and in event_clients", () => {
    const primary = [ev({ id: "shared", name: "Shared", event_date: "2026-03-01" })];
    const links = [
      { role: "Contract Holder", event: ev({ id: "shared", name: "Shared", event_date: "2026-03-01" }) },
    ];
    const merged = mergeClientEvents(primary, links);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].client_role, "Contract Holder");
  });

  it("keeps primary when join role is empty", () => {
    const primary = [ev({ id: "shared", event_date: "2026-03-01" })];
    const links = [{ role: null, event: ev({ id: "shared", event_date: "2026-03-01" }) }];
    const merged = mergeClientEvents(primary, links);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].client_role, null);
  });

  it("unions primary + linked without duplicates and sorts by date desc", () => {
    const primary = [
      ev({ id: "primary-old", event_date: "2024-01-01" }),
      ev({ id: "both", event_date: "2026-05-01" }),
    ];
    const links = [
      { role: "Groom", event: ev({ id: "both", event_date: "2026-05-01" }) },
      { role: "Mother of the Bride", event: ev({ id: "linked-only", event_date: "2025-08-15" }) },
      { role: "Planner", event: null },
    ];
    const merged = mergeClientEvents(primary, links);
    assert.deepEqual(
      merged.map((e) => ({ id: e.id, role: e.client_role })),
      [
        { id: "both", role: "Groom" },
        { id: "linked-only", role: "Mother of the Bride" },
        { id: "primary-old", role: null },
      ],
    );
  });

  it("skips archived when excludeArchived is set", () => {
    const primary = [
      ev({ id: "live", event_date: "2026-01-01" }),
      ev({ id: "gone", event_date: "2025-01-01", archived_at: "2025-06-01T00:00:00Z" }),
    ];
    const links = [
      {
        role: "Client",
        event: ev({ id: "linked-gone", event_date: "2024-01-01", archived_at: "2024-02-01T00:00:00Z" }),
      },
      { role: "Bride", event: ev({ id: "linked-live", event_date: "2026-02-01" }) },
    ];
    const merged = mergeClientEvents(primary, links, { excludeArchived: true });
    assert.deepEqual(
      merged.map((e) => e.id),
      ["linked-live", "live"],
    );
  });

  it("includes archived by default (profile page behavior)", () => {
    const primary = [ev({ id: "gone", event_date: "2025-01-01", archived_at: "2025-06-01T00:00:00Z" })];
    const merged = mergeClientEvents(primary, []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "gone");
  });

  it("treats null/undefined inputs as empty", () => {
    assert.deepEqual(mergeClientEvents(null, undefined), []);
    assert.deepEqual(mergeClientEvents(undefined, null), []);
  });
});

describe("compareEventDateDesc", () => {
  it("orders newer first and nulls last", () => {
    assert.ok(compareEventDateDesc("2026-01-01", "2025-01-01") < 0);
    assert.ok(compareEventDateDesc("2025-01-01", "2026-01-01") > 0);
    assert.equal(compareEventDateDesc("2026-01-01", "2026-01-01"), 0);
    assert.ok(compareEventDateDesc(null, "2026-01-01") > 0);
    assert.ok(compareEventDateDesc("2026-01-01", null) < 0);
    assert.equal(compareEventDateDesc(null, null), 0);
  });
});
