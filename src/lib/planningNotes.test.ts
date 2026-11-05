import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PLANNING_NOTE_MAX,
  isDoNotPlaySectionTitle,
  noteWriteStatus,
  notesGetBody,
  parseDoNotPlayPut,
  parseNotesPut,
  parsePlanningNote,
  planningNotesAccess,
} from "./planningNotes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(join(root, "supabase/migrations/00207_planning_section_notes.sql"), "utf8");
const notesRoute = readFileSync(join(root, "src/app/api/mobile/planning/sections/[id]/notes/route.ts"), "utf8");
const avoidRoute = readFileSync(join(root, "src/app/api/mobile/planning/do-not-play-notes/route.ts"), "utf8");
const planner = readFileSync(join(root, "src/components/planner/Planner.tsx"), "utf8");
const eventPage = readFileSync(join(root, "src/app/(app)/events/[id]/page.tsx"), "utf8");
const planningLib = readFileSync(join(root, "src/lib/planning.ts"), "utf8");

describe("parsePlanningNote", () => {
  it("trims and turns a blank value into null", () => {
    assert.deepEqual(parsePlanningNote("  hello  "), { ok: true, value: "hello" });
    assert.deepEqual(parsePlanningNote("   "), { ok: true, value: null });
    assert.deepEqual(parsePlanningNote(""), { ok: true, value: null });
  });

  it("rejects non-strings and text over the cap", () => {
    assert.equal(parsePlanningNote(null).ok, false);
    assert.equal(parsePlanningNote(12).ok, false);
    const tooLong = parsePlanningNote("a".repeat(PLANNING_NOTE_MAX + 1));
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.match(tooLong.error, /4000/);
    assert.equal(parsePlanningNote("a".repeat(PLANNING_NOTE_MAX)).ok, true);
  });
});

describe("section notes access", () => {
  it("lets hosts and staff through, and guests only on a guest-enabled section", () => {
    assert.equal(planningNotesAccess("staff", false), "ok");
    assert.equal(planningNotesAccess("host", false), "ok");
    assert.equal(planningNotesAccess("guest", true), "ok");
    assert.equal(planningNotesAccess("guest", false), "forbidden");
    assert.equal(planningNotesAccess(null, true), "forbidden");
  });

  it("omits staffNotes unless the caller is staff", () => {
    assert.deepEqual(notesGetBody("hi", "secret", "staff"), { notes: "hi", staffNotes: "secret" });
    assert.deepEqual(notesGetBody("hi", "secret", "host"), { notes: "hi" });
    assert.deepEqual(notesGetBody(null, "secret", "guest"), { notes: null });
    assert.equal("staffNotes" in notesGetBody("hi", "secret", "host"), false);
  });

  it("rejects staffNotes from anyone who is not staff, and notes from a guest", () => {
    const host = parseNotesPut({ notes: "  details  ", staffNotes: "hidden" }, "host");
    assert.equal(host.ok, false);
    if (!host.ok) assert.equal(host.status, 403);

    const guest = parseNotesPut({ notes: "nope" }, "guest");
    assert.equal(guest.ok, false);
    if (!guest.ok) assert.equal(guest.status, 403);

    const staff = parseNotesPut({ notes: "  details  ", staffNotes: "  internal  " }, "staff");
    assert.deepEqual(staff, { ok: true, notes: "details", staffNotes: "internal" });

    const cleared = parseNotesPut({ notes: "  " }, "host");
    assert.deepEqual(cleared, { ok: true, notes: null });

    const empty = parseNotesPut({}, "staff");
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.status, 400);
  });

  it("maps a row-level security failure to 403", () => {
    assert.equal(noteWriteStatus(null), null);
    assert.equal(noteWriteStatus({ code: "42501", message: "Only client_notes can be updated" }), 403);
    assert.equal(noteWriteStatus({ message: "new row violates row-level security policy" }), 403);
    assert.equal(noteWriteStatus({ message: "connection reset" }), 500);
  });
});

describe("do-not-play text", () => {
  it("recognizes the Don't Play section and not Open Dancing", () => {
    assert.equal(isDoNotPlaySectionTitle("Don't Play"), true);
    assert.equal(isDoNotPlaySectionTitle("Don’t Play"), true);
    assert.equal(isDoNotPlaySectionTitle("Do not play"), true);
    assert.equal(isDoNotPlaySectionTitle("Open Dancing"), false);
    assert.equal(isDoNotPlaySectionTitle("Dinner Music"), false);
  });

  it("accepts { text: string | null }, trims, and rejects anything else", () => {
    assert.deepEqual(parseDoNotPlayPut({ text: null }), { ok: true, text: null });
    assert.deepEqual(parseDoNotPlayPut({ text: "  no Pitbull  " }), { ok: true, text: "no Pitbull" });
    assert.deepEqual(parseDoNotPlayPut({ text: "   " }), { ok: true, text: null });
    const missing = parseDoNotPlayPut({});
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 400);
    const bad = parseDoNotPlayPut({ text: 4 });
    assert.equal(bad.ok, false);
    const long = parseDoNotPlayPut({ text: "a".repeat(PLANNING_NOTE_MAX + 1) });
    assert.equal(long.ok, false);
  });
});

describe("migration 00207", () => {
  it("adds client_notes and keeps non-staff updates to that column", () => {
    assert.match(migration, /add column if not exists client_notes text/);
    assert.match(migration, /create policy "host update client notes"/);
    assert.match(migration, /xos_is_host\(event_id\)/);
    assert.match(migration, /Only client_notes can be updated for this event/);
    assert.match(migration, /current_user in \('service_role', 'postgres', 'supabase_admin'\)/);
  });

  it("keeps staff notes in their own table with staff-only policies", () => {
    assert.match(migration, /create table if not exists public\.planning_section_staff_notes/);
    assert.match(migration, /create policy "staff read section staff notes"/);
    assert.match(migration, /create policy "staff insert section staff notes"/);
    assert.match(migration, /create policy "staff update section staff notes"/);
    assert.match(migration, /using \(\(select public\.xos_is_staff\(\)\)\)/);
    assert.doesNotMatch(migration, /planning_section_staff_notes[\s\S]{0,500}xos_is_host/);
    assert.doesNotMatch(migration, /planning_section_staff_notes[\s\S]{0,700}xos_guest_of/);
    assert.doesNotMatch(migration, /on public\.planning_section_staff_notes\s+for all/i);
    assert.match(migration, /revoke all on table public\.planning_section_staff_notes from public, anon/);
  });

  it("stores the do-not-play free text per event, not on the section", () => {
    assert.match(migration, /create table if not exists public\.planning_do_not_play_notes/);
    assert.match(migration, /event_id\s+uuid primary key references public\.events/);
    assert.match(migration, /create policy "host read do not play notes"/);
    assert.match(migration, /create policy "host insert do not play notes"/);
    assert.match(migration, /create policy "host update do not play notes"/);
    assert.match(migration, /revoke all on table public\.planning_do_not_play_notes from public, anon/);
    assert.match(migration, /Not the per-song do-not-play flags/);
  });
});

describe("mobile routes and staff UI", () => {
  it("returns staff notes only through notesGetBody and rejects a missing token first", () => {
    assert.match(notesRoute, /notesGetBody\(/);
    assert.match(notesRoute, /parseNotesPut\(/);
    assert.match(notesRoute, /if \(!token\) return NextResponse\.json\(\{ error: "Unauthorized" \}/);
    assert.doesNotMatch(notesRoute, /staffNotes:/);
  });

  it("serves do-not-play text at the dedicated route with { text }", () => {
    assert.match(avoidRoute, /searchParams\.get\("eventId"\)/);
    assert.match(avoidRoute, /parseDoNotPlayPut\(/);
    assert.match(avoidRoute, /NextResponse\.json\(\{ text:/);
    assert.match(avoidRoute, /planning_do_not_play_notes/);
    assert.match(avoidRoute, /who\.role !== "staff" && who\.role !== "host"/);
  });

  it("shows both note fields to staff and the avoid text beside do-not-play songs", () => {
    assert.match(planner, /showStaffNotes=\{isStaff\}/);
    assert.match(planner, /staffNotes=\{isStaff \? section\.staff_notes : null\}/);
    assert.match(planner, /isDoNotPlaySectionTitle\(section\.title\)/);
    assert.match(planner, /<DoNotPlayText/);
    assert.match(eventPage, /<DoNotPlayPanel/);
    assert.match(eventPage, /<EventSectionNotes/);
    assert.match(planningLib, /isStaff\s*\?\s*supabase\.from\("planning_section_staff_notes"\)/);
    assert.match(planningLib, /role === "guest" \? null :/);
  });
});
