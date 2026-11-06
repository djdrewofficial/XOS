import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canReadEventFile,
  guestSongMoveAllowed,
  moneyPoliciesAfter00213,
  moneyPoliciesIfHideWerePermissive,
  rowVisible,
  sectionUpdateAllowed,
  type MoneyActor,
  type SectionRow,
} from "./guestAccessRules.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(join(root, "supabase/migrations/00213_event_join_links.sql"), "utf8");

const staff: MoneyActor = { staff: true, hostOfEvent: true, marketing: false };
const host: MoneyActor = { staff: false, hostOfEvent: true, marketing: false };
const guest: MoneyActor = { staff: false, hostOfEvent: false, marketing: false };
const stranger: MoneyActor = { staff: false, hostOfEvent: false, marketing: false };
const marketingStaff: MoneyActor = { staff: true, hostOfEvent: true, marketing: true };

const section: SectionRow = {
  id: "sec",
  event_id: "event-a",
  title: "Cocktail hour",
  sort_order: 2,
  guest_enabled: true,
  client_editable: true,
  locked: false,
  client_notes: null,
};

describe("financial policy interaction", () => {
  const policies = moneyPoliciesAfter00213();

  it("gives guests and unrelated clients no money rows, hidden or not", () => {
    for (const actor of [guest, stranger]) {
      assert.equal(rowVisible(policies, actor, false), false);
      assert.equal(rowVisible(policies, actor, true), false);
    }
  });

  it("lets a host read a normal event and still hides a venue-paid event", () => {
    assert.equal(rowVisible(policies, host, false), true);
    assert.equal(rowVisible(policies, host, true), false);
  });

  it("lets staff read venue-paid rows and still blocks the marketing tier", () => {
    assert.equal(rowVisible(policies, staff, true), true);
    assert.equal(rowVisible(policies, staff, false), true);
    assert.equal(rowVisible(policies, marketingStaff, false), false);
  });

  it("shows why a permissive staff-OR-not-hidden policy would leak to strangers", () => {
    const leaked = moneyPoliciesIfHideWerePermissive();
    assert.equal(rowVisible(leaked, guest, false), true);
    assert.equal(rowVisible(leaked, stranger, false), true);
    assert.equal(rowVisible(leaked, guest, true), false);
    assert.equal(rowVisible(policies, guest, false), false);
    assert.equal(rowVisible(policies, stranger, false), false);
  });
});

describe("guest section columns", () => {
  it("lets a guest change notes and nothing else on an open section", () => {
    assert.equal(sectionUpdateAllowed("guest", section, { ...section, client_notes: "no country" }), "ok");
    assert.equal(sectionUpdateAllowed("guest", section, { ...section, title: "Renamed" }), "forbidden");
    assert.equal(sectionUpdateAllowed("guest", section, { ...section, sort_order: 0 }), "forbidden");
    assert.equal(sectionUpdateAllowed("guest", section, { ...section, guest_enabled: false }), "forbidden");
    assert.equal(sectionUpdateAllowed("guest", section, { ...section, event_id: "event-b" }), "forbidden");
    assert.equal(sectionUpdateAllowed("guest", section, { ...section, locked: true }), "forbidden");
    assert.equal(sectionUpdateAllowed("guest", section, { ...section, client_editable: false }), "forbidden");
  });

  it("keeps the same column lock for hosts and lets staff change the section", () => {
    assert.equal(sectionUpdateAllowed("host", section, { ...section, client_notes: "yes" }), "ok");
    assert.equal(sectionUpdateAllowed("host", section, { ...section, title: "Renamed" }), "forbidden");
    assert.equal(sectionUpdateAllowed("staff", section, { ...section, title: "Renamed", guest_enabled: false }), "ok");
    assert.equal(sectionUpdateAllowed("service", section, { ...section, event_id: "event-b" }), "ok");
  });

  it("stops a guest from moving their song onto another event", () => {
    const song = { id: "song", event_id: "event-a", section_id: "sec-a", requested_by: "guest-user" };
    assert.equal(guestSongMoveAllowed(song, { ...song }), "ok");
    assert.equal(guestSongMoveAllowed(song, { ...song, event_id: "event-b" }), "forbidden");
    assert.equal(guestSongMoveAllowed(song, { ...song, section_id: "sec-b" }), "forbidden");
    assert.equal(guestSongMoveAllowed(song, { ...song, requested_by: "someone-else" }), "forbidden");
  });
});

describe("event file scope", () => {
  const eventA = "32e79b00-bfa5-4cc1-ae4d-488b0a2fab87";
  const eventB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("lets a host read only their event folder", () => {
    const hostA = { staff: false, hostOf: new Set([eventA]) };
    assert.equal(canReadEventFile(hostA, `${eventA}/agreement.pdf`), true);
    assert.equal(canReadEventFile(hostA, `${eventB}/agreement.pdf`), false);
    assert.equal(canReadEventFile(hostA, "not-a-uuid/agreement.pdf"), false);
    assert.equal(canReadEventFile({ staff: false, hostOf: new Set() }, `${eventA}/agreement.pdf`), false);
    assert.equal(canReadEventFile({ staff: true, hostOf: new Set() }, `${eventB}/agreement.pdf`), true);
  });
});

describe("00213 sql matches the rules", () => {
  it("keeps the venue-paid policy restrictive and requires a host", () => {
    const blocks = migration.split('create policy "hide venue-paid financials"').slice(1);
    assert.equal(blocks.length, 3);
    for (const block of blocks) {
      assert.match(block, /as restrictive for select to authenticated/);
      assert.match(block, /public\.xos_is_staff\(\)/);
      assert.match(block, /public\.xos_is_host\(event_id\) and not public\.event_financials_hidden\(event_id\)/);
    }
    assert.match(migration, /create policy "read own event payments"[\s\S]*using \(public\.xos_is_host\(event_id\)\)/);
    assert.equal(migration.includes("xos_can_access_event(event_id)"), false);
  });

  it("locks guest section updates to client_notes in the trigger", () => {
    assert.match(migration, /create policy "guest update client notes on open sections"/);
    assert.match(migration, /new\.title is distinct from old\.title/);
    assert.match(migration, /new\.sort_order is distinct from old\.sort_order/);
    assert.match(migration, /new\.guest_enabled is distinct from old\.guest_enabled/);
    assert.match(migration, /new\.event_id is distinct from old\.event_id/);
    assert.match(migration, /Only client_notes can be updated for this event/);
    assert.match(migration, /if public\.xos_is_staff\(\) then/);
    assert.match(migration, /Guests cannot move a song to another event or section/);
    assert.match(migration, /account_id = auth\.uid\(\)/);
    assert.match(migration, /create policy "guest read song likes on open sections"/);
    assert.match(migration, /create policy "guest write own song likes"/);
  });

  it("keeps the guest card behind a barrier and the file path on one event", () => {
    assert.match(migration, /security_invoker = off, security_barrier = true/);
    assert.match(migration, /where public\.xos_guest_of\(e\.id\)/);
    assert.match(migration, /revoke all on public\.event_guest_card from public, anon/);
    assert.match(migration, /revoke all on function public\.xos_is_host\(uuid\) from public, anon/);
    assert.match(migration, /revoke all on function public\.xos_guest_of\(uuid\) from public, anon/);
    assert.match(migration, /grant execute on function public\.xos_is_host\(uuid\) to authenticated, service_role/);
    assert.match(migration, /xos_is_host\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/);
  });
});
