import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "./auth.ts";
import { requireEventTouch, requireOffice } from "./fieldStaff.ts";
import { executeBookingHelper } from "./bookingHelperRun.ts";
import { createEventOnboardingRecord } from "./eventOnboarding.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const actions = readFileSync(join(root, "src/app/(app)/events/actions.ts"), "utf8");

const EVENT = "11111111-1111-4111-8111-111111111111";
const HELPER = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const VENUE = "44444444-4444-4444-8444-444444444444";
const ROOM = "55555555-5555-4555-8555-555555555555";

function me(fieldStaff: boolean, employeeId: string | null = "e1"): Me {
  return { userId: "u1", accountType: "staff", employeeId, role: fieldStaff ? "employee" : "admin", fieldStaff } as unknown as Me;
}

type Row = Record<string, unknown>;
type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };

/** Minimal PostgREST-shaped fake. `rows[table]` answers selects; `fail[table]` fails inserts. */
function fakeDb(rows: Record<string, Row[]>, fail: Record<string, string> = {}, rpcResult: { data?: unknown; error: { message: string } | null } = { error: null }) {
  const calls: Call[] = [];
  const rpcs: string[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const result = () => {
      if (call.op === "insert" && fail[table]) return { data: null, error: { message: fail[table] } };
      if (call.op === "insert") return { data: { id: table === "events" ? EVENT : "row" }, error: null };
      const found = (rows[table] ?? []).filter((r) => call.filters.every(([k, v]) => r[k] === v));
      return { data: found, error: null };
    };
    const api = {
      select() { if (call.op === "select") calls.push(call); return api; },
      insert(payload: unknown) { call.op = "insert"; call.payload = payload; calls.push(call); return api; },
      upsert(payload: unknown) { call.op = "insert"; call.payload = payload; calls.push(call); return api; },
      update(payload: unknown) { call.op = "update"; call.payload = payload; calls.push(call); return api; },
      delete() { call.op = "delete"; calls.push(call); return api; },
      eq(k: string, v: unknown) { call.filters.push([k, v]); return api; },
      limit() { return api; },
      order() { return api; },
      lte() { return api; },
      gte() { return api; },
      maybeSingle: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
      single: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
      then(ok: (v: unknown) => void, bad?: (e: unknown) => void) { return Promise.resolve(result()).then(ok, bad); },
    };
    return api;
  };
  const db = {
    from,
    rpc: async (name: string) => { rpcs.push(name); return rpcResult; },
  } as unknown as SupabaseClient;
  return { db, calls, rpcs };
}

function body(fn: string): string {
  const start = actions.indexOf(`export async function ${fn}(`);
  assert.ok(start >= 0, fn);
  const next = actions.indexOf("\nexport async function ", start + 1);
  return actions.slice(start, next < 0 ? undefined : next);
}

describe("field staff cannot use the helper or membership paths as a side door", () => {
  it("refuses field staff on an event they are not assigned to, before any helper preview or run", async () => {
    const { db } = fakeDb({ event_staff: [{ id: "s1", event_id: "other-event", employee_id: "e1" }] });
    await assert.rejects(() => requireEventTouch(db, me(true), EVENT), /Not authorized for this event/);
    const assigned = fakeDb({ event_staff: [{ id: "s1", event_id: EVENT, employee_id: "e1" }] });
    await requireEventTouch(assigned.db, me(true), EVENT);
    await requireEventTouch(fakeDb({}).db, me(false), EVENT);
    for (const [fn, call] of [["getHelperSmsPrompts", "previewHelperSms("], ["runBookingHelper", "executeBookingHelper("]] as const) {
      const src = body(fn);
      const gate = src.indexOf("await assignedOrOffice(eventId)");
      assert.ok(gate >= 0, `${fn} gates on assignment`);
      assert.ok(gate < src.indexOf(call), `${fn} gates before ${call}`);
    }
  });

  it("blocks field staff on a helper with empty allowed_roles inside executeBookingHelper", async () => {
    const open = fakeDb({
      booking_helpers: [{ id: HELPER, title: "Send Quote", visible_event_type_ids: [], allowed_roles: [] }],
      events: [{ id: EVENT, event_type_id: null }],
    });
    await assert.rejects(
      () => executeBookingHelper(open.db, { eventId: EVENT, helperId: HELPER, actorRole: "employee", actorFieldStaff: true, enforceRole: true }),
      /can't run "Send Quote"/,
    );
    await assert.rejects(
      () => executeBookingHelper(open.db, { eventId: EVENT, helperId: HELPER, actorRole: "employee", actorFieldStaff: true, enforceRole: false }),
      /can't run "Send Quote"/,
    );
    assert.deepEqual(open.rpcs, []);

    const listed = fakeDb(
      {
        booking_helpers: [{ id: HELPER, title: "Send Quote", visible_event_type_ids: [], allowed_roles: ["employee"] }],
        events: [{ id: EVENT, event_type_id: null }],
      },
      {},
      { error: { message: "stop after guard" } },
    );
    await assert.rejects(
      () => executeBookingHelper(listed.db, { eventId: EVENT, helperId: HELPER, actorRole: "employee", actorFieldStaff: true, enforceRole: true }),
      /stop after guard/,
    );
    assert.deepEqual(listed.rpcs, ["run_booking_helper"]);
    assert.match(body("runBookingHelper"), /actorFieldStaff: me\?\.fieldStaff === true/);
  });

  it("refuses field staff on client removal, primary, and contract-holder changes before the RPC", () => {
    assert.throws(() => requireOffice(me(true)), /Not authorized/);
    requireOffice(me(false));
    for (const [fn, rpc] of [
      ["removeEventClient", "mcp_remove_event_client"],
      ["setPrimaryEventClient", "mcp_set_primary_client"],
      ["toggleContractHolder", "mcp_toggle_contract_holder"],
    ] as const) {
      const src = body(fn);
      const gate = src.indexOf("await officeOnly()");
      assert.ok(gate >= 0, `${fn} is office-only`);
      assert.ok(gate < src.indexOf(rpc), `${fn} checks before ${rpc}`);
    }
  });
});

describe("connector onboarding uses createEventCore", () => {
  it("rejects a primary client missing a cell phone before inserting an event", async () => {
    const { db, calls } = fakeDb({ clients: [{ id: CLIENT, first_name: "Ada", last_name: "L", email: "ada@example.com", cell_phone: null }] });
    await assert.rejects(
      () => createEventOnboardingRecord(db, { clients: [{ mode: "existing", client_id: CLIENT, is_primary: true }], drain: "all" }),
      /Primary client is missing: cell phone/,
    );
    assert.equal(calls.some((c) => c.table === "events" && c.op === "insert"), false);
  });

  it("drops a room from another venue and deletes the event when a child insert fails", async () => {
    const { db, calls } = fakeDb(
      {
        clients: [{ id: CLIENT, first_name: "Ada", last_name: "L", email: "ada@example.com", cell_phone: "3055550100" }],
        venue_rooms: [{ id: ROOM, venue_id: "someone-else" }],
      },
      { event_clients: "insert denied" },
    );
    await assert.rejects(
      () => createEventOnboardingRecord(db, {
        clients: [{ mode: "existing", client_id: CLIENT, is_primary: true }],
        venueId: VENUE,
        venueRoomId: ROOM,
        drain: "all",
      }),
      /Saving the clients: insert denied/,
    );
    const inserted = calls.find((c) => c.table === "events" && c.op === "insert");
    assert.equal((inserted?.payload as Row).venue_room_id, null);
    const removed = calls.find((c) => c.table === "events" && c.op === "delete");
    assert.deepEqual(removed?.filters, [["id", EVENT]]);
  });
});
