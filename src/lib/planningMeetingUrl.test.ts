import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  DEFAULT_PLANNING_MEETING_URL,
  resolvePlanningMeetingUrl,
} from "./planningMeetingUrl.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(
  join(root, "supabase/migrations/00227_planning_meeting_link_fallback.sql"),
  "utf8",
);
const emailPreview = readFileSync(
  join(root, "src/app/api/email-preview/route.ts"),
  "utf8",
);

describe("resolvePlanningMeetingUrl", () => {
  it("keeps a saved DJ planning link", () => {
    assert.equal(
      resolvePlanningMeetingUrl("https://xpressdjs.com/philplanning"),
      "https://xpressdjs.com/philplanning",
    );
  });

  it("falls back when the profile field is null, empty, or whitespace", () => {
    assert.equal(resolvePlanningMeetingUrl(null), DEFAULT_PLANNING_MEETING_URL);
    assert.equal(resolvePlanningMeetingUrl(undefined), DEFAULT_PLANNING_MEETING_URL);
    assert.equal(resolvePlanningMeetingUrl(""), DEFAULT_PLANNING_MEETING_URL);
    assert.equal(resolvePlanningMeetingUrl("   "), DEFAULT_PLANNING_MEETING_URL);
  });

  it("uses the trailing-slash company booking URL", () => {
    assert.equal(DEFAULT_PLANNING_MEETING_URL, "https://xpressdjs.com/drewplanning/");
  });
});

describe("migration 00227 planning meeting link fallback", () => {
  it("puts the fallback URL in one SQL helper and wires both merge tags to it", () => {
    assert.match(migration, /create or replace function public\.xos_default_planning_meeting_url/);
    assert.match(migration, /create or replace function public\.xos_event_planning_meeting_url/);
    assert.match(migration, /https:\/\/xpressdjs\.com\/drewplanning\//);
    assert.match(migration, /poc_planning_link/);
    assert.match(migration, /dj_calendar_link/);
    assert.match(migration, /xos_event_planning_meeting_url\(e\.id\)/);
    assert.match(migration, /We're Alive 6 \(30 Days\)/);
    // Fallback appears once as the SQL constant (not scattered).
    const urlHits = migration.match(/https:\/\/xpressdjs\.com\/drewplanning\//g) ?? [];
    assert.equal(urlHits.length, 1);
  });

  it("email preview samples the shared TypeScript fallback constant", () => {
    assert.match(emailPreview, /DEFAULT_PLANNING_MEETING_URL/);
    assert.match(emailPreview, /poc_planning_link:\s*DEFAULT_PLANNING_MEETING_URL/);
    assert.match(emailPreview, /dj_calendar_link:\s*DEFAULT_PLANNING_MEETING_URL/);
  });

  it("SQL helper returns the DJ URL or the company fallback", async () => {
    const db = new PGlite();
    await db.exec(`
      create table employees (
        id uuid primary key,
        first_name text,
        stage_name text,
        planning_meeting_url text
      );
      create table event_staff (
        event_id uuid not null,
        employee_id uuid not null references employees(id),
        role text
      );
    `);

    const start = migration.indexOf("create or replace function public.xos_default_planning_meeting_url");
    // Stop before revoke/grant (PGlite has no anon/authenticated/service_role roles).
    const end = migration.indexOf("revoke all on function public.xos_default_planning_meeting_url");
    assert.ok(start >= 0 && end > start, "planning URL helpers missing from migration");
    await db.exec(migration.slice(start, end));

    const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const djWithLink = "11111111-1111-4111-8111-111111111111";
    const djBlank = "22222222-2222-4222-8222-222222222222";

    await db.exec(`
      insert into employees (id, first_name, stage_name, planning_meeting_url) values
        ('${djWithLink}', 'Phil', 'DJ Phil', 'https://xpressdjs.com/philplanning'),
        ('${djBlank}', 'Drew', 'DJ Drew', null);
    `);

    // No staff → fallback
    const empty = await db.query<{ url: string }>(
      `select public.xos_event_planning_meeting_url($1::uuid) as url`,
      [eventId],
    );
    assert.equal(empty.rows[0].url, DEFAULT_PLANNING_MEETING_URL);

    // Blank DJ profile → fallback
    await db.exec(`
      insert into event_staff (event_id, employee_id, role) values
        ('${eventId}', '${djBlank}', 'DJ');
    `);
    const blank = await db.query<{ url: string }>(
      `select public.xos_event_planning_meeting_url($1::uuid) as url`,
      [eventId],
    );
    assert.equal(blank.rows[0].url, DEFAULT_PLANNING_MEETING_URL);

    // Primary DJ (same order as djemployee1_*) with a saved link wins
    await db.exec(`delete from event_staff where event_id = '${eventId}'`);
    await db.exec(`
      insert into event_staff (event_id, employee_id, role) values
        ('${eventId}', '${djWithLink}', 'DJ');
    `);
    const filled = await db.query<{ url: string }>(
      `select public.xos_event_planning_meeting_url($1::uuid) as url`,
      [eventId],
    );
    assert.equal(filled.rows[0].url, "https://xpressdjs.com/philplanning");

    assert.equal(
      resolvePlanningMeetingUrl(null),
      (await db.query<{ url: string }>(`select public.xos_default_planning_meeting_url() as url`)).rows[0].url,
    );
  });
});
