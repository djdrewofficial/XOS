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
  it("keeps the first non-empty candidate (POC before DJ)", () => {
    assert.equal(
      resolvePlanningMeetingUrl(
        "https://xpressdjs.com/officeplanning",
        "https://www.xpressdjs.com/atomicplanning",
      ),
      "https://xpressdjs.com/officeplanning",
    );
    assert.equal(
      resolvePlanningMeetingUrl(null, "https://www.xpressdjs.com/atomicplanning"),
      "https://www.xpressdjs.com/atomicplanning",
    );
  });

  it("falls back when every candidate is null, empty, or whitespace", () => {
    assert.equal(resolvePlanningMeetingUrl(null), DEFAULT_PLANNING_MEETING_URL);
    assert.equal(resolvePlanningMeetingUrl(undefined, ""), DEFAULT_PLANNING_MEETING_URL);
    assert.equal(resolvePlanningMeetingUrl("", "   "), DEFAULT_PLANNING_MEETING_URL);
  });

  it("uses the trailing-slash company booking URL", () => {
    assert.equal(DEFAULT_PLANNING_MEETING_URL, "https://xpressdjs.com/drewplanning/");
  });
});

describe("migration 00227 planning meeting link fallback", () => {
  it("documents poc_planning_link → POC planning_meeting_url and the fallback chain", () => {
    assert.match(migration, /create or replace function public\.xos_default_planning_meeting_url/);
    assert.match(migration, /create or replace function public\.xos_dj_planning_meeting_url/);
    assert.match(migration, /create or replace function public\.xos_event_planning_meeting_url/);
    assert.match(migration, /https:\/\/xpressdjs\.com\/drewplanning\//);
    assert.match(migration, /point_of_contact_employee_id/);
    assert.match(migration, /poc_planning_link/);
    assert.match(migration, /dj_calendar_link/);
    assert.match(migration, /xos_event_planning_meeting_url\(e\.id\)/);
    assert.match(migration, /xos_dj_planning_meeting_url\(e\.id\)/);
    assert.match(migration, /We're Alive 6 \(30 Days\)/);
    assert.match(migration, /not a HighLevel custom field/);
    // Fallback appears once as the SQL constant (not scattered).
    const urlHits = migration.match(/https:\/\/xpressdjs\.com\/drewplanning\//g) ?? [];
    assert.equal(urlHits.length, 1);
  });

  it("email preview samples the shared TypeScript fallback constant", () => {
    assert.match(emailPreview, /DEFAULT_PLANNING_MEETING_URL/);
    assert.match(emailPreview, /poc_planning_link:\s*DEFAULT_PLANNING_MEETING_URL/);
    assert.match(emailPreview, /dj_calendar_link:\s*DEFAULT_PLANNING_MEETING_URL/);
  });

  it("SQL helpers resolve POC → DJ → company fallback", async () => {
    const db = new PGlite();
    await db.exec(`
      create table employees (
        id uuid primary key,
        first_name text,
        stage_name text,
        planning_meeting_url text
      );
      create table events (
        id uuid primary key,
        point_of_contact_employee_id uuid references employees(id)
      );
      create table event_staff (
        event_id uuid not null references events(id),
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
    const pocId = "33333333-3333-4333-8333-333333333333";
    const djWithLink = "11111111-1111-4111-8111-111111111111";
    const djBlank = "22222222-2222-4222-8222-222222222222";

    await db.exec(`
      insert into employees (id, first_name, stage_name, planning_meeting_url) values
        ('${pocId}', 'Laura', 'Office', 'https://xpressdjs.com/officeplanning'),
        ('${djWithLink}', 'Dimitri', 'DJ Atomic', 'https://www.xpressdjs.com/atomicplanning'),
        ('${djBlank}', 'Drew', 'DJ Drew', null);
      insert into events (id, point_of_contact_employee_id) values ('${eventId}', null);
    `);

    // No POC, no staff → company fallback (Atomic-style blank CTA today)
    let row = await db.query<{ url: string }>(
      `select public.xos_event_planning_meeting_url($1::uuid) as url`,
      [eventId],
    );
    assert.equal(row.rows[0].url, DEFAULT_PLANNING_MEETING_URL);

    // No POC, DJ with link → DJ URL (fixes Atomic 30-day emails)
    await db.exec(`
      insert into event_staff (event_id, employee_id, role) values
        ('${eventId}', '${djWithLink}', 'DJ');
    `);
    row = await db.query<{ url: string }>(
      `select public.xos_event_planning_meeting_url($1::uuid) as url`,
      [eventId],
    );
    assert.equal(row.rows[0].url, "https://www.xpressdjs.com/atomicplanning");
    const djOnly = await db.query<{ url: string }>(
      `select public.xos_dj_planning_meeting_url($1::uuid) as url`,
      [eventId],
    );
    assert.equal(djOnly.rows[0].url, "https://www.xpressdjs.com/atomicplanning");

    // POC with link wins over DJ
    await db.exec(`update events set point_of_contact_employee_id = '${pocId}' where id = '${eventId}'`);
    row = await db.query<{ url: string }>(
      `select public.xos_event_planning_meeting_url($1::uuid) as url`,
      [eventId],
    );
    assert.equal(row.rows[0].url, "https://xpressdjs.com/officeplanning");

    // POC blank → DJ → still Atomic URL
    await db.exec(`update employees set planning_meeting_url = null where id = '${pocId}'`);
    row = await db.query<{ url: string }>(
      `select public.xos_event_planning_meeting_url($1::uuid) as url`,
      [eventId],
    );
    assert.equal(row.rows[0].url, "https://www.xpressdjs.com/atomicplanning");

    // POC blank + blank DJ → company fallback
    await db.exec(`
      delete from event_staff where event_id = '${eventId}';
      insert into event_staff (event_id, employee_id, role) values ('${eventId}', '${djBlank}', 'DJ');
    `);
    row = await db.query<{ url: string }>(
      `select public.xos_event_planning_meeting_url($1::uuid) as url`,
      [eventId],
    );
    assert.equal(row.rows[0].url, DEFAULT_PLANNING_MEETING_URL);

    assert.equal(
      resolvePlanningMeetingUrl(null, null),
      (await db.query<{ url: string }>(`select public.xos_default_planning_meeting_url() as url`)).rows[0].url,
    );
  });
});
