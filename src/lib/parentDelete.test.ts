/* Parent-deletion compatibility for migrations 00214, 00215, and 00216.
   Local Postgres only. These files are not applied to the shared database.
   Deletes run as supabase_auth_admin with no auth.uid(), the same shape as
   Auth admin account deletion. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const host = "11111111-1111-4111-8111-111111111111";
const guest = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const staff = "44444444-4444-4444-8444-444444444444";
const clientOnly = "55555555-5555-4555-8555-555555555555";
const guestOnly = "66666666-6666-4666-8666-666666666666";
const clientH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const event1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const event2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const guestRow = "77777777-7777-4777-8777-777777777777";
const guestRow2 = "88888888-8888-4888-8888-888888888888";
const section1 = "99999999-9999-4999-8999-999999999999";
const song1 = "12121212-1212-4212-8212-121212121212";
const song2 = "13131313-1313-4313-8313-131313131313";
const answer1 = "14141414-1414-4414-8414-141414141414";

describe("parent deletion across consent, history, content, blocks, and reports", { timeout: 60_000 }, () => {
  let db: PGlite;

  async function denied(sql: string): Promise<string> {
    try {
      await db.exec(sql);
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  it("keeps booking rows and report evidence, and rejects direct rewrites", async () => {
    db = new PGlite();
    await db.exec(`
      create schema if not exists auth;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create role supabase_auth_admin superuser;
      grant usage on schema public to anon, authenticated, service_role;
      grant usage on schema auth to anon, authenticated, service_role;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      create table public.clients (id uuid primary key, cell_phone text);
      create table public.events (
        id uuid primary key,
        client_id uuid references public.clients(id),
        cover_photo_url text
      );
      create table public.event_clients (
        event_id uuid references public.events(id) on delete cascade,
        client_id uuid references public.clients(id) on delete cascade,
        is_contract_holder boolean not null default false,
        is_primary boolean not null default false
      );
      create table public.event_guests (
        id uuid primary key,
        event_id uuid not null references public.events(id) on delete cascade
      );
      create table public.accounts (
        auth_user_id uuid primary key references auth.users(id) on delete cascade,
        account_type text not null,
        client_id uuid references public.clients(id) on delete cascade,
        event_guest_id uuid references public.event_guests(id) on delete cascade,
        employee_id uuid
      );
      create table public.employees (
        id uuid primary key default gen_random_uuid(),
        auth_user_id uuid references auth.users(id) on delete cascade
      );
      create table public.event_app_members (
        event_id uuid not null references public.events(id) on delete cascade,
        auth_user_id uuid not null references auth.users(id) on delete cascade,
        role text
      );
      create table public.planning_sections (
        id uuid primary key,
        event_id uuid not null references public.events(id) on delete cascade,
        title text,
        sort_order int,
        guest_enabled boolean,
        client_editable boolean,
        locked boolean,
        deleted_by_host boolean,
        deleted_by_host_at timestamptz,
        client_notes text
      );
      create table public.planning_songs (
        id uuid primary key,
        section_id uuid not null references public.planning_sections(id) on delete cascade,
        event_id uuid not null references public.events(id) on delete cascade,
        title text not null,
        requested_by uuid references auth.users(id) on delete set null
      );
      create table public.planning_song_likes (
        song_id uuid not null references public.planning_songs(id) on delete cascade,
        account_id uuid not null references auth.users(id) on delete cascade,
        primary key (song_id, account_id)
      );
      create table public.planning_question_answers (
        question_id uuid primary key,
        event_id uuid not null references public.events(id) on delete cascade,
        answer text,
        answered_by uuid references auth.users(id) on delete set null
      );
      create table public.song_ideas (
        id uuid primary key,
        event_id uuid not null references public.events(id) on delete cascade,
        title text,
        added_by uuid references auth.users(id) on delete set null
      );
      create table public.planning_do_not_play_notes (
        event_id uuid primary key references public.events(id) on delete cascade,
        updated_by uuid references auth.users(id) on delete set null
      );
      create table public.event_photobooth_selection (
        event_id uuid primary key references public.events(id) on delete cascade,
        updated_by uuid references auth.users(id) on delete set null
      );
      create table public.event_files (
        id uuid primary key,
        event_id uuid references public.events(id) on delete cascade,
        source text,
        uploaded_by uuid references auth.users(id) on delete set null
      );
      create table public.notification_types (
        key text primary key, label text, category text, description text,
        staff_title_tpl text, staff_body_tpl text, href_tpl text, sort_order int
      );
      create table public.notification_settings (
        type_key text, audience text, is_enabled boolean, in_app boolean, push boolean, email boolean, sms boolean,
        primary key (type_key, audience)
      );
      create function public.xos_is_staff() returns boolean
      language sql stable security definer set search_path = public as $$
        select exists (
          select 1 from accounts a where a.auth_user_id = auth.uid() and a.account_type = 'staff'
        ) or exists (
          select 1 from employees e where e.auth_user_id = auth.uid()
        );
      $$;
      create function public.xos_is_host(p_event_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select public.xos_is_staff()
          or exists (
            select 1 from public.accounts a
            where a.auth_user_id = auth.uid() and a.account_type = 'client'
              and (
                exists (select 1 from public.events e where e.id = p_event_id and e.client_id = a.client_id)
                or exists (select 1 from public.event_clients ec where ec.event_id = p_event_id and ec.client_id = a.client_id)
              )
          )
          or exists (
            select 1 from public.event_app_members m
            where m.event_id = p_event_id and m.auth_user_id = auth.uid() and m.role = 'host'
          );
      $$;
      create function public.xos_guest_of(p_event_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select not public.xos_is_host(p_event_id)
          and exists (
            select 1 from public.event_app_members m
            where m.event_id = p_event_id and m.auth_user_id = auth.uid() and m.role = 'guest'
          );
      $$;
      grant execute on function public.xos_is_staff() to anon, authenticated, service_role;
      grant execute on function public.xos_is_host(uuid) to authenticated, service_role;
      grant execute on function public.xos_guest_of(uuid) to authenticated, service_role;
    `);
    await db.exec(read("supabase/migrations/00214_ai_consent.sql"));
    await db.exec(read("supabase/migrations/00215_sms_marketing_consent.sql"));
    await db.exec(read("supabase/migrations/00216_event_ugc_moderation.sql"));
    await db.exec(`
      grant select on public.accounts, public.events, public.event_clients, public.event_guests, public.event_app_members
        to authenticated, service_role;
      grant select, update, delete on public.planning_songs to authenticated;
      grant select, delete on public.planning_song_likes to authenticated;
      alter table public.planning_songs enable row level security;
      alter table public.planning_song_likes enable row level security;
      create policy songs_read on public.planning_songs for select to authenticated using (true);
      create policy songs_delete on public.planning_songs for delete to authenticated using (true);
      create policy songs_update on public.planning_songs for update to authenticated using (true) with check (true);
      create policy likes_read on public.planning_song_likes for select to authenticated using (true);
      create policy likes_delete on public.planning_song_likes for delete to authenticated using (account_id = auth.uid());
    `);
    await db.exec(`
      insert into auth.users (id) values
        ('${host}'), ('${guest}'), ('${other}'), ('${staff}'), ('${clientOnly}'), ('${guestOnly}');
      insert into public.clients (id, cell_phone) values
        ('${clientH}', '305-555-1212'),
        ('${clientC}', '786-555-0100');
      insert into public.events (id, client_id) values
        ('${event1}', '${clientH}'),
        ('${event2}', null);
      insert into public.event_clients (event_id, client_id, is_contract_holder, is_primary)
        values ('${event2}', '${clientC}', true, false);
      insert into public.event_guests (id, event_id) values
        ('${guestRow}', '${event1}'),
        ('${guestRow2}', '${event1}');
      insert into public.accounts (auth_user_id, account_type, client_id, event_guest_id) values
        ('${host}', 'client', '${clientH}', null),
        ('${guest}', 'event_guest', null, '${guestRow}'),
        ('${other}', 'event_guest', null, null),
        ('${staff}', 'staff', null, null),
        ('${clientOnly}', 'client', '${clientC}', null),
        ('${guestOnly}', 'event_guest', null, '${guestRow2}');
      insert into public.event_app_members (event_id, auth_user_id, role) values
        ('${event1}', '${host}', 'host'),
        ('${event1}', '${guest}', 'guest'),
        ('${event1}', '${other}', 'guest'),
        ('${event2}', '${host}', 'host'),
        ('${event2}', '${other}', 'guest');
      insert into public.planning_sections (id, event_id, title, client_notes) values
        ('${section1}', '${event1}', 'Ceremony', 'Keep this note');
      insert into public.planning_songs (id, section_id, event_id, title, requested_by) values
        ('${song1}', '${section1}', '${event1}', 'First dance', '${host}'),
        ('${song2}', '${section1}', '${event2}', 'Other event song', '${host}');
      insert into public.planning_song_likes (song_id, account_id) values
        ('${song1}', '${guest}'),
        ('${song1}', '${other}'),
        ('${song1}', '${host}');
      insert into public.planning_question_answers (question_id, event_id, answer, answered_by) values
        ('${answer1}', '${event1}', 'Outdoor vows', '${guest}');
      update public.planning_sections set client_notes_updated_by = '${host}' where id = '${section1}';
      update public.planning_songs set hidden_by = '${host}' where id = '${song1}';
    `);

    await db.exec("set role service_role");
    await db.exec(`
      select public.ai_consent_save('${host}', '${event1}', 'grant', '2026-11-06', 'app');
      select public.ai_consent_save('${clientOnly}', '${event2}', 'grant', '2026-11-06', 'app');
      select public.sms_marketing_consent_record('${host}', '${event1}', 'grant', '2026-11-06', 'app');
      select public.sms_marketing_consent_record('${clientOnly}', '${event2}', 'grant', '2026-11-06', 'app');
    `);
    await db.exec("reset role");
    await db.exec(`select set_config('request.jwt.claim.sub', '${host}', false)`);
    await db.exec("set role authenticated");
    await db.exec(`
      insert into public.event_member_blocks (event_id, blocker_id, blocked_id) values
        ('${event1}', '${host}', '${guest}'),
        ('${event2}', '${host}', '${other}');
      insert into public.event_content_reports
        (event_id, reporter_id, target_type, target_user_id, reason, details)
      values
        ('${event1}', '${host}', 'user', '${guest}', 'harassment', 'person report stays');
      insert into public.event_content_reports
        (event_id, reporter_id, target_type, target_id, target_user_id, reason, details)
      values
        ('${event1}', '${host}', 'song_like', '${song1}', '${other}', 'spam', 'like report stays');
    `);
    await db.exec(`select set_config('request.jwt.claim.sub', '${guest}', false)`);
    const movedSong = await denied(`
      update public.planning_songs set requested_by = '${guest}' where id = '${song1}'
    `);
    assert.match(movedSong, /cannot move a song/i);
    await db.exec(`delete from public.planning_song_likes where song_id = '${song1}' and account_id = '${guest}'`);
    const hardSong = await denied(`delete from public.planning_songs where id = '${song1}'`);
    assert.match(hardSong, /hiding it/i);
    await db.exec(`
      insert into public.event_member_blocks (event_id, blocker_id, blocked_id) values
        ('${event1}', '${guest}', '${host}');
      insert into public.event_content_reports
        (event_id, reporter_id, target_type, target_id, reason, details)
      values
        ('${event1}', '${guest}', 'song', '${song1}', 'other', 'filed by guest');
    `);
    await db.exec(`select set_config('request.jwt.claim.sub', '${other}', false)`);
    await db.exec(`
      insert into public.event_member_blocks (event_id, blocker_id, blocked_id) values
        ('${event1}', '${other}', '${guest}');
    `);
    await db.exec(`select set_config('request.jwt.claim.sub', '${staff}', false)`);
    await db.exec(`
      update public.event_content_reports
      set status = 'resolved'
      where reporter_id = '${host}' and target_type = 'user';
    `);
    await db.exec("reset role");
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);

    const directBlock = await denied(`
      delete from public.event_member_blocks
      where blocker_id = '${host}' and blocked_id = '${guest}'
    `);
    assert.match(directBlock, /only be removed by the member who created it/i);
    const directTarget = await denied(`
      update public.event_content_reports
      set target_user_id = null
      where reporter_id = '${host}' and target_type = 'user'
    `);
    assert.match(directTarget, /identity cannot be changed/i);
    const directReason = await denied(`
      update public.event_content_reports
      set reason = 'offensive'
      where reporter_id = '${host}' and target_type = 'song_like'
    `);
    assert.match(directReason, /identity cannot be changed/i);
    await db.exec("set role service_role");
    const serviceBlock = await denied(`
      delete from public.event_member_blocks where blocker_id = '${other}'
    `);
    assert.match(serviceBlock, /only be removed by the member who created it/i);
    await db.exec("reset role");
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);

    await db.exec("set role supabase_auth_admin");
    await db.exec(`delete from public.clients where id = '${clientC}'`);
    await db.exec("reset role");
    const afterClient = await db.query<{ consent: number; phone: string | null; client_id: string | null; event_left: number }>(`
      select
        (select count(*)::int from public.ai_consents where auth_user_id = '${clientOnly}') as consent,
        (select phone_e164 from public.sms_marketing_consent_events where auth_user_id = '${clientOnly}') as phone,
        (select client_id from public.sms_marketing_consent_events where auth_user_id = '${clientOnly}') as client_id,
        (select count(*)::int from public.events where id = '${event1}') as event_left
    `);
    assert.equal(afterClient.rows[0].consent, 0);
    assert.equal(afterClient.rows[0].phone, "+17865550100");
    assert.equal(afterClient.rows[0].client_id, null);
    assert.equal(afterClient.rows[0].event_left, 1);

    await db.exec("set role supabase_auth_admin");
    await db.exec(`delete from public.events where id = '${event2}'`);
    await db.exec("reset role");
    const event2Gone = await db.query<{ songs: number; blocks: number; consent: number }>(`
      select
        (select count(*)::int from public.planning_songs where event_id = '${event2}') as songs,
        (select count(*)::int from public.event_member_blocks where event_id = '${event2}') as blocks,
        (select count(*)::int from public.ai_consents where event_id = '${event2}') as consent
    `);
    assert.equal(event2Gone.rows[0].songs, 0);
    assert.equal(event2Gone.rows[0].blocks, 0);
    assert.equal(event2Gone.rows[0].consent, 0);
    const event1Song = await db.query<{ title: string }>(
      `select title from public.planning_songs where id = '${song1}'`,
    );
    assert.equal(event1Song.rows[0].title, "First dance");

    await db.exec("set role supabase_auth_admin");
    await db.exec(`delete from auth.users where id = '${staff}'`);
    await db.exec("reset role");
    const afterResolver = await db.query<{
      reason: string;
      details: string;
      status: string;
      resolved_by: string | null;
      target_user_id: string | null;
    }>(
      `select reason, details, status, resolved_by, target_user_id
       from public.event_content_reports
       where reporter_id = '${host}' and target_type = 'user'`,
    );
    assert.equal(afterResolver.rows.length, 1);
    assert.equal(afterResolver.rows[0].reason, "harassment");
    assert.equal(afterResolver.rows[0].details, "person report stays");
    assert.equal(afterResolver.rows[0].status, "resolved");
    assert.equal(afterResolver.rows[0].resolved_by, null);
    assert.equal(afterResolver.rows[0].target_user_id, guest);

    await db.exec("set role supabase_auth_admin");
    await db.exec(`delete from auth.users where id = '${other}'`);
    await db.exec("reset role");
    const afterReportedLike = await db.query<{
      reason: string;
      details: string;
      target_id: string;
      target_user_id: string | null;
      reporter_id: string;
    }>(
      `select reason, details, target_id, target_user_id, reporter_id
       from public.event_content_reports
       where target_type = 'song_like'`,
    );
    assert.equal(afterReportedLike.rows.length, 1);
    assert.equal(afterReportedLike.rows[0].reason, "spam");
    assert.equal(afterReportedLike.rows[0].details, "like report stays");
    assert.equal(afterReportedLike.rows[0].target_id, song1);
    assert.equal(afterReportedLike.rows[0].target_user_id, null);
    assert.equal(afterReportedLike.rows[0].reporter_id, host);
    const otherLike = await db.query<{ n: number }>(
      `select count(*)::int as n from public.planning_song_likes where account_id = '${other}'`,
    );
    assert.equal(otherLike.rows[0].n, 0);
    const songStill = await db.query<{ title: string; requested_by: string }>(
      `select title, requested_by from public.planning_songs where id = '${song1}'`,
    );
    assert.equal(songStill.rows[0].title, "First dance");
    assert.equal(songStill.rows[0].requested_by, host);

    await db.exec("set role supabase_auth_admin");
    await db.exec(`delete from auth.users where id = '${guest}'`);
    await db.exec("reset role");
    const afterGuest = await db.query<{
      reports_about: number;
      reports_by: number;
      blocks: number;
      answer: string | null;
      answered_by: string | null;
    }>(`
      select
        (select count(*)::int from public.event_content_reports where target_type = 'user') as reports_about,
        (select count(*)::int from public.event_content_reports where reporter_id = '${guest}') as reports_by,
        (select count(*)::int from public.event_member_blocks
          where blocker_id = '${guest}' or blocked_id = '${guest}') as blocks,
        (select answer from public.planning_question_answers where question_id = '${answer1}') as answer,
        (select answered_by from public.planning_question_answers where question_id = '${answer1}') as answered_by
    `);
    assert.equal(afterGuest.rows[0].reports_about, 1);
    assert.equal(afterGuest.rows[0].reports_by, 0);
    assert.equal(afterGuest.rows[0].blocks, 0);
    assert.equal(afterGuest.rows[0].answer, "Outdoor vows");
    assert.equal(afterGuest.rows[0].answered_by, null);
    const personReport = await db.query<{ target_user_id: string | null; details: string }>(
      `select target_user_id, details from public.event_content_reports where target_type = 'user'`,
    );
    assert.equal(personReport.rows[0].target_user_id, null);
    assert.equal(personReport.rows[0].details, "person report stays");

    await db.exec("set role supabase_auth_admin");
    await db.exec(`delete from public.event_guests where id = '${guestRow2}'`);
    await db.exec("reset role");
    const afterGuestRow = await db.query<{ account: number; login: number }>(`
      select
        (select count(*)::int from public.accounts where auth_user_id = '${guestOnly}') as account,
        (select count(*)::int from auth.users where id = '${guestOnly}') as login
    `);
    assert.equal(afterGuestRow.rows[0].account, 0);
    assert.equal(afterGuestRow.rows[0].login, 1);

    await db.exec("set role supabase_auth_admin");
    await db.exec(`delete from auth.users where id = '${host}'`);
    await db.exec("reset role");
    const afterHost = await db.query<{
      ai: number;
      sms: number;
      reports: number;
      blocks: number;
      likes: number;
      title: string;
      requested_by: string | null;
      hidden_by: string | null;
      notes: string;
      notes_by: string | null;
    }>(`
      select
        (select count(*)::int from public.ai_consents where auth_user_id = '${host}') as ai,
        (select count(*)::int from public.sms_marketing_consent_events where auth_user_id = '${host}') as sms,
        (select count(*)::int from public.event_content_reports where reporter_id = '${host}') as reports,
        (select count(*)::int from public.event_member_blocks
          where blocker_id = '${host}' or blocked_id = '${host}') as blocks,
        (select count(*)::int from public.planning_song_likes where account_id = '${host}') as likes,
        (select title from public.planning_songs where id = '${song1}') as title,
        (select requested_by from public.planning_songs where id = '${song1}') as requested_by,
        (select hidden_by from public.planning_songs where id = '${song1}') as hidden_by,
        (select client_notes from public.planning_sections where id = '${section1}') as notes,
        (select client_notes_updated_by from public.planning_sections where id = '${section1}') as notes_by
    `);
    assert.equal(afterHost.rows[0].ai, 0);
    assert.equal(afterHost.rows[0].sms, 0);
    assert.equal(afterHost.rows[0].reports, 0);
    assert.equal(afterHost.rows[0].blocks, 0);
    assert.equal(afterHost.rows[0].likes, 0);
    assert.equal(afterHost.rows[0].title, "First dance");
    assert.equal(afterHost.rows[0].requested_by, null);
    assert.equal(afterHost.rows[0].hidden_by, null);
    assert.equal(afterHost.rows[0].notes, "Keep this note");
    assert.equal(afterHost.rows[0].notes_by, null);
    const answerKept = await db.query<{ answer: string }>(
      `select answer from public.planning_question_answers where question_id = '${answer1}'`,
    );
    assert.equal(answerKept.rows[0].answer, "Outdoor vows");
  });
});
