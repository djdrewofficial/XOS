/* Local Postgres stand-in for time-clock lockdown (migration 00232).
   Stubs the 00230 tables/helpers, applies 00232, then exercises RLS,
   the event_staff guard allowlist, self-punch stamping, and admin audit. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const userField = "11111111-1111-4111-8111-111111111111";
const userOffice = "22222222-2222-4222-8222-222222222222";
const userOther = "33333333-3333-4333-8333-333333333333";
const empField = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const empOffice = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const empOther = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const eventId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const staffField = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const staffOther = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

describe("00232 time clock lockdown", { timeout: 60_000 }, () => {
  let db: PGlite;

  async function denied(sql: string): Promise<string> {
    try {
      await db.exec(sql);
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async function asUser(userId: string | null) {
    await db.exec("reset role");
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ""}', false)`);
  }

  before(async () => {
    db = new PGlite();
    await db.exec(`
      create schema if not exists auth;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      grant usage on schema auth to anon, authenticated, service_role;

      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant execute on function auth.uid() to anon, authenticated, service_role;

      create table public.employees (
        id uuid primary key,
        auth_user_id uuid references auth.users(id),
        permission_tier text
      );
      create table public.events (id uuid primary key);
      create table public.payroll_payables (id uuid primary key);

      create table public.event_staff (
        id uuid primary key,
        event_id uuid not null references public.events(id) on delete cascade,
        employee_id uuid not null references public.employees(id),
        role text,
        pay_type text default 'hourly',
        flat_wage numeric,
        hourly_rate_override numeric,
        notified_at timestamptz,
        confirmed_at timestamptz,
        declined_at timestamptz,
        checked_in_at timestamptz,
        checked_out_at timestamptz,
        timesheet_status text not null default 'open',
        timesheet_hours numeric(10,4),
        timesheet_amount numeric(10,2),
        timesheet_rate numeric(10,2),
        timesheet_approved_by uuid,
        timesheet_approved_at timestamptz,
        timesheet_locked_at timestamptz,
        timesheet_payable_id uuid,
        location_missing boolean not null default false
      );

      create table public.time_clock_settings (
        id boolean primary key default true check (id),
        admin_edit_requires_reason boolean not null default true
      );
      insert into public.time_clock_settings (id) values (true);

      create table public.time_punches (
        id uuid primary key default gen_random_uuid(),
        event_staff_id uuid not null references public.event_staff(id) on delete cascade,
        employee_id uuid not null references public.employees(id),
        event_id uuid not null references public.events(id) on delete cascade,
        punch_type text not null check (punch_type in ('in', 'out')),
        punched_at timestamptz not null,
        lat numeric(9,6),
        lng numeric(9,6),
        accuracy_m numeric(10,2),
        venue_lat numeric(9,6),
        venue_lng numeric(9,6),
        distance_m numeric(12,2),
        location_missing boolean not null default false,
        source text not null default 'self' check (source in ('self', 'admin', 'backfill')),
        note text,
        created_by uuid references public.employees(id),
        created_at timestamptz not null default now(),
        deleted_at timestamptz
      );

      create table public.time_punch_edits (
        id uuid primary key default gen_random_uuid(),
        punch_id uuid,
        event_staff_id uuid not null references public.event_staff(id) on delete cascade,
        action text not null check (action in ('insert', 'update', 'delete')),
        before_row jsonb,
        after_row jsonb,
        reason text not null,
        edited_by uuid not null references public.employees(id),
        created_at timestamptz not null default now()
      );

      create or replace function public.xos_current_employee_id()
      returns uuid language sql stable security definer set search_path = public as $$
        select id from public.employees where auth_user_id = auth.uid() limit 1;
      $$;
      create or replace function public.xos_is_field_staff()
      returns boolean language sql stable security definer set search_path = public as $$
        select auth.uid() is not null and exists (
          select 1 from public.employees e
          where e.auth_user_id = auth.uid()
            and (e.permission_tier is null or e.permission_tier in ('employee', 'marketing'))
        );
      $$;
      create or replace function public.xos_sees_all_events()
      returns boolean language sql stable security definer set search_path = public as $$
        select not public.xos_is_field_staff();
      $$;

      -- Pre-lockdown guard (00230 shape) so 00232 can replace it.
      create or replace function public.xos_event_staff_field_guard()
      returns trigger language plpgsql security definer set search_path = public as $$
      declare
        allowed text[] := array[
          'notified_at', 'confirmed_at', 'declined_at', 'checked_in_at', 'checked_out_at',
          'location_missing', 'timesheet_hours'
        ];
      begin
        if current_setting('xos.syncing_punches', true) = '1' then
          return coalesce(new, old);
        end if;
        if auth.uid() is null or not public.xos_is_field_staff() then
          return coalesce(new, old);
        end if;
        if tg_op <> 'UPDATE' then
          raise exception 'field staff cannot % event staff assignments', lower(tg_op) using errcode = '42501';
        end if;
        if old.employee_id is distinct from public.xos_current_employee_id() then
          raise exception 'field staff can only update their own assignment' using errcode = '42501';
        end if;
        if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
          raise exception 'field staff can only update check-in/confirmation fields' using errcode = '42501';
        end if;
        return new;
      end;
      $$;
      create trigger event_staff_field_guard
        before insert or update or delete on public.event_staff
        for each row execute function public.xos_event_staff_field_guard();

      -- Punch sync helper from 00230 (bypass must keep working after lockdown).
      create or replace function public.xos_punch_hours(p_event_staff_id uuid)
      returns numeric language sql stable as $$ select 0::numeric $$;
      create or replace function public.xos_sync_event_staff_from_punches(p_event_staff_id uuid)
      returns void language plpgsql security definer set search_path = public as $$
      begin
        perform set_config('xos.syncing_punches', '1', true);
        update public.event_staff es
        set location_missing = true,
            timesheet_hours = 1.5,
            checked_in_at = coalesce(es.checked_in_at, now())
        where es.id = p_event_staff_id;
      end;
      $$;

      alter table public.time_punches enable row level security;
      alter table public.time_punch_edits enable row level security;
      alter table public.event_staff enable row level security;
      alter table public.time_clock_settings enable row level security;

      create policy "authenticated full access" on public.time_punches
        for all to authenticated using (true) with check (true);
      create policy "authenticated full access" on public.time_punch_edits
        for all to authenticated using (true) with check (true);
      create policy "authenticated full access" on public.event_staff
        for all to authenticated using (true) with check (true);
      create policy "authenticated full access" on public.time_clock_settings
        for all to authenticated using (true) with check (true);

      -- Pre-lockdown punch scope (00230) replaced by 00232.
      create policy "field staff scope" on public.time_punches as restrictive for all to authenticated
        using (xos_sees_all_events() or employee_id = xos_current_employee_id())
        with check (
          xos_sees_all_events()
          or (
            employee_id = xos_current_employee_id()
            and exists (
              select 1 from public.event_staff es
              where es.id = event_staff_id and es.employee_id = xos_current_employee_id()
            )
          )
        );
      create policy "field staff scope" on public.time_punch_edits as restrictive for all to authenticated
        using (
          xos_sees_all_events()
          or exists (
            select 1 from public.event_staff es
            where es.id = event_staff_id and es.employee_id = xos_current_employee_id()
          )
        )
        with check (xos_sees_all_events());

      grant select, insert, update, delete on public.time_punches to authenticated;
      grant select, insert, update, delete on public.time_punch_edits to authenticated;
      grant select, insert, update, delete on public.event_staff to authenticated;
      grant select, update on public.time_clock_settings to authenticated;

      insert into auth.users (id) values ('${userField}'), ('${userOffice}'), ('${userOther}');
      insert into public.employees (id, auth_user_id, permission_tier) values
        ('${empField}', '${userField}', 'employee'),
        ('${empOffice}', '${userOffice}', 'master_admin'),
        ('${empOther}', '${userOther}', 'employee');
      insert into public.events (id) values ('${eventId}');
      insert into public.event_staff (id, event_id, employee_id, role) values
        ('${staffField}', '${eventId}', '${empField}', 'DJ'),
        ('${staffOther}', '${eventId}', '${empOther}', 'DJ');
    `);

    await db.exec(read("supabase/migrations/00232_time_clock_lockdown.sql"));
  });

  it("migration SQL drops timesheet_hours and location_missing from the guard allowlist", () => {
    const sql = read("supabase/migrations/00232_time_clock_lockdown.sql");
    assert.match(sql, /00232_time_clock_lockdown/);
    assert.match(sql, /xos_event_staff_field_guard/);
    assert.match(sql, /xos\.syncing_punches/);
    assert.match(sql, /allowed text\[] := array\[\s*'notified_at'/);
    assert.doesNotMatch(
      sql,
      /allowed text\[] := array\[[^\]]*timesheet_hours/s,
    );
    assert.doesNotMatch(
      sql,
      /allowed text\[] := array\[[^\]]*location_missing/s,
    );
    assert.match(sql, /field staff scope ins.*time_punches|on public\.time_punches[\s\S]*field staff scope ins/s);
    assert.match(sql, /source = 'self'/);
    assert.match(sql, /new\.punched_at := now\(\)/);
    assert.match(sql, /xos_time_punches_audit_edit/);
    assert.match(sql, /xos_time_punch_admin_update/);
    assert.doesNotMatch(sql, /—/);
  });

  it("blocks field staff from updating timesheet_hours or location_missing", async () => {
    await asUser(userField);
    await db.exec("set role authenticated");
    const hours = await denied(`
      update public.event_staff set timesheet_hours = 99 where id = '${staffField}'
    `);
    assert.match(hours, /check-in\/confirmation fields|42501|permission/i);

    const missing = await denied(`
      update public.event_staff set location_missing = true where id = '${staffField}'
    `);
    assert.match(missing, /check-in\/confirmation fields|42501|permission/i);

    // Confirmation stamps remain allowed.
    await db.exec(`
      update public.event_staff set confirmed_at = now() where id = '${staffField}'
    `);
    await db.exec("reset role");
  });

  it("still lets punch sync update timesheet_hours via the guard bypass", async () => {
    await db.exec("reset role");
    await db.exec(`
      update public.event_staff
      set timesheet_hours = null, location_missing = false, checked_in_at = null
      where id = '${staffField}'
    `);
    await asUser(userField);
    await db.exec("set role authenticated");
    // Simulate the security-definer sync path used by the punch trigger.
    await db.exec(`select public.xos_sync_event_staff_from_punches('${staffField}')`);
    await db.exec("reset role");
    const row = await db.query<{ timesheet_hours: number; location_missing: boolean }>(
      `select timesheet_hours, location_missing from public.event_staff where id = '${staffField}'`,
    );
    assert.equal(Number(row.rows[0].timesheet_hours), 1.5);
    assert.equal(row.rows[0].location_missing, true);
  });

  it("lets field staff insert only their own self punches and stamps punched_at/source", async () => {
    await asUser(userField);
    await db.exec("set role authenticated");

    const other = await denied(`
      insert into public.time_punches (
        event_staff_id, employee_id, event_id, punch_type, punched_at, source
      ) values (
        '${staffOther}', '${empOther}', '${eventId}', 'in',
        '2020-01-01T00:00:00Z', 'self'
      )
    `);
    assert.match(other, /permission denied|only punch their own|42501/i);

    // Client may send source=admin or an old punched_at; trigger forces self + now().
    await db.exec(`
      insert into public.time_punches (
        event_staff_id, employee_id, event_id, punch_type, punched_at, source
      ) values (
        '${staffField}', '${empField}', '${eventId}', 'in',
        '2020-01-01T00:00:00Z', 'admin'
      )
    `);
    const punched = await db.query<{ punched_at: string; source: string; id: string }>(
      `select id::text, punched_at::text, source from public.time_punches
       where event_staff_id = '${staffField}' and deleted_at is null
       order by created_at desc limit 1`,
    );
    assert.equal(punched.rows[0].source, "self");
    assert.ok(Math.abs(Date.now() - Date.parse(punched.rows[0].punched_at)) < 60_000);
    assert.notEqual(punched.rows[0].punched_at.slice(0, 4), "2020");

    const beforeAt = punched.rows[0].punched_at;
    const punchId = punched.rows[0].id;
    // RLS filters the row out of UPDATE/DELETE (0 rows), so assert immutability.
    await db.exec(`
      update public.time_punches set punched_at = '2020-01-01T00:00:00Z' where id = '${punchId}'
    `);
    await db.exec(`delete from public.time_punches where id = '${punchId}'`);
    const still = await db.query<{ punched_at: string; n: number }>(
      `select punched_at::text, 1 as n from public.time_punches where id = '${punchId}'`,
    );
    assert.equal(still.rows.length, 1);
    assert.equal(still.rows[0].punched_at, beforeAt);
    await db.exec("reset role");
  });

  it("audits office punch updates and requires a reason when configured", async () => {
    await db.exec("reset role");
    await asUser(userOffice);
    await db.exec("set role authenticated");

    // Seed a punch as office (insert path; reason gate is UPDATE/DELETE only).
    const punchId = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
    await db.exec(`
      insert into public.time_punches (
        id, event_staff_id, employee_id, event_id, punch_type, punched_at, source, created_by
      ) values (
        '${punchId}',
        '${staffField}', '${empField}', '${eventId}', 'out',
        now(), 'admin', '${empOffice}'
      )
    `);

    const noReason = await denied(`
      update public.time_punches set note = 'oops' where id = '${punchId}'
    `);
    assert.match(noReason, /reason is required/i);

    // Reason + mutate must share one transaction (RPC); separate HTTP/exec calls cannot.
    await db.exec(`
      select public.xos_time_punch_admin_update(
        '${punchId}'::uuid,
        '{"note":"lunch","source":"admin"}'::jsonb,
        'fixed lunch out'
      )
    `);

    const edits = await db.query<{ action: string; reason: string; edited_by: string }>(
      `select action, reason, edited_by::text from public.time_punch_edits
       where punch_id = '${punchId}' order by created_at desc limit 1`,
    );
    assert.equal(edits.rows[0].action, "update");
    assert.equal(edits.rows[0].reason, "fixed lunch out");
    assert.equal(edits.rows[0].edited_by, empOffice);

    await db.exec(`select public.xos_time_punch_admin_soft_delete('${punchId}'::uuid, 'removed bad punch')`);
    const soft = await db.query<{ action: string; reason: string }>(
      `select action, reason from public.time_punch_edits
       where punch_id = '${punchId}' order by created_at desc limit 1`,
    );
    assert.equal(soft.rows[0].action, "delete");
    assert.equal(soft.rows[0].reason, "removed bad punch");
    await db.exec("reset role");
  });
});
