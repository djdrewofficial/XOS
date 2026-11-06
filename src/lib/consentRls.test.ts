/* Local Postgres stand-in for the authenticated Data API.
   Migrations 00214 and 00215 are not applied to the shared database.
   PGlite runs those files here, then signed-in and service-role sessions
   try the same writes PostgREST would allow. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const userStaff = "33333333-3333-4333-8333-333333333333";
const userCohost = "44444444-4444-4444-8444-444444444444";
const userGuest = "66666666-6666-4666-8666-666666666666";
const userNoPhone = "55555555-5555-4555-8555-555555555555";
const clientA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clientCohost = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const clientNoPhone = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const eventA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const eventB = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const eventOpen = "99999999-9999-4999-8999-999999999999";
const guestId = "77777777-7777-4777-8777-777777777777";

describe("consent writes under authenticated and service-role sessions", { timeout: 60_000 }, () => {
  let db: PGlite;

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

      create table public.clients (
        id uuid primary key,
        cell_phone text
      );
      create table public.events (
        id uuid primary key,
        client_id uuid references public.clients(id)
      );
      create table public.event_clients (
        event_id uuid references public.events(id),
        client_id uuid references public.clients(id),
        is_contract_holder boolean not null default false,
        is_primary boolean not null default false
      );
      create table public.event_guests (
        id uuid primary key,
        event_id uuid references public.events(id)
      );
      create table public.accounts (
        auth_user_id uuid primary key references auth.users(id) on delete cascade,
        account_type text not null,
        client_id uuid references public.clients(id) on delete cascade,
        event_guest_id uuid references public.event_guests(id)
      );
      create table public.employees (
        id uuid primary key default gen_random_uuid(),
        auth_user_id uuid references auth.users(id)
      );
      create function public.xos_is_staff() returns boolean
      language sql stable security definer set search_path = public as $$
        select exists (
          select 1 from accounts a
          where a.auth_user_id = auth.uid() and a.account_type = 'staff'
        ) or exists (
          select 1 from employees e where e.auth_user_id = auth.uid()
        );
      $$;
      grant execute on function public.xos_is_staff() to anon, authenticated, service_role;
    `);
    await db.exec(read("supabase/migrations/00214_ai_consent.sql"));
    await db.exec(read("supabase/migrations/00215_sms_marketing_consent.sql"));
    await db.exec(`
      insert into auth.users (id) values
        ('${userA}'), ('${userB}'), ('${userStaff}'), ('${userCohost}'), ('${userGuest}'), ('${userNoPhone}');
      insert into public.clients (id, cell_phone) values
        ('${clientA}', '305-555-1212'),
        ('${clientB}', '786-555-0100'),
        ('${clientCohost}', '954-555-0199'),
        ('${clientNoPhone}', null);
      insert into public.events (id, client_id) values
        ('${eventA}', '${clientA}'),
        ('${eventB}', '${clientB}'),
        ('${eventOpen}', null);
      insert into public.event_clients (event_id, client_id, is_contract_holder, is_primary) values
        ('${eventA}', '${clientCohost}', false, false),
        ('${eventOpen}', '${clientA}', true, false);
      insert into public.event_guests (id, event_id) values ('${guestId}', '${eventA}');
      insert into public.accounts (auth_user_id, account_type, client_id, event_guest_id) values
        ('${userA}', 'client', '${clientA}', null),
        ('${userB}', 'client', '${clientB}', null),
        ('${userStaff}', 'staff', null, null),
        ('${userCohost}', 'client', '${clientCohost}', null),
        ('${userGuest}', 'event_guest', null, '${guestId}'),
        ('${userNoPhone}', 'client', '${clientNoPhone}', null);
    `);
  });

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

  it("rejects authenticated and service-role Data API inserts and updates", async () => {
    await asUser(userA);
    await db.exec("set role authenticated");
    const aiInsert = await denied(`
      insert into public.ai_consents (auth_user_id, client_id, event_id, granted_at, policy_version, source)
      values ('${userA}', '${clientB}', '${eventA}', '2099-01-01', '2026-11-06', 'app')
    `);
    assert.match(aiInsert, /permission denied/i);

    const smsInsert = await denied(`
      insert into public.sms_marketing_consent_events
        (auth_user_id, client_id, event_id, phone_e164, action, disclosure_version, source, created_at)
      values ('${userA}', '${clientB}', '${eventB}', '+19995550100', 'grant', '2026-11-06', 'app', '2099-01-01')
    `);
    assert.match(smsInsert, /permission denied/i);

    const aiRpc = await denied(`
      select public.ai_consent_save('${userA}', '${eventA}', 'grant', '2026-11-06', 'app')
    `);
    assert.match(aiRpc, /permission denied/i);
    const smsRpc = await denied(`
      select public.sms_marketing_consent_record('${userA}', null, 'grant', '2026-11-06', 'app')
    `);
    assert.match(smsRpc, /permission denied/i);

    await db.exec("reset role");
    await db.exec("set role service_role");
    const serviceAi = await denied(`
      insert into public.ai_consents (auth_user_id, client_id, event_id, granted_at, policy_version, source)
      values ('${userA}', '${clientB}', '${eventA}', now(), '2026-11-06', 'app')
    `);
    assert.match(serviceAi, /permission denied/i);
    const serviceSms = await denied(`
      insert into public.sms_marketing_consent_events
        (auth_user_id, client_id, phone_e164, action, disclosure_version, source)
      values ('${userA}', '${clientA}', '+19995550100', 'grant', '2026-11-06', 'app')
    `);
    assert.match(serviceSms, /permission denied/i);
    await db.exec("reset role");
  });

  it("saves AI consent only for the contract client's own account and event", async () => {
    await db.exec("reset role");
    await db.exec("set role service_role");
    const otherEvent = await denied(`
      select public.ai_consent_save('${userA}', '${eventB}', 'grant', '2026-11-06', 'app')
    `);
    assert.match(otherEvent, /not this client contract/i);
    const cohost = await denied(`
      select public.ai_consent_save('${userCohost}', '${eventA}', 'grant', '2026-11-06', 'app')
    `);
    assert.match(cohost, /not this client contract/i);
    const guest = await denied(`
      select public.ai_consent_save('${userGuest}', '${eventA}', 'grant', '2026-11-06', 'app')
    `);
    assert.match(guest, /contract client account/i);
    const staff = await denied(`
      select public.ai_consent_save('${userStaff}', '${eventA}', 'grant', '2026-11-06', 'app')
    `);
    assert.match(staff, /contract client account/i);

    await db.exec(`
      select public.ai_consent_save('${userA}', '${eventA}', 'grant', '2026-11-06', 'app')
    `);
    await db.exec(`
      select public.ai_consent_save('${userA}', '${eventOpen}', 'grant', '2026-11-06', 'web')
    `);
    await db.exec("reset role");

    const saved = await db.query<{ client_id: string; event_guest_id: string | null; granted_at: string; created_at: string }>(
      `select client_id, event_guest_id, granted_at::text, created_at::text
       from public.ai_consents where auth_user_id = $1 and event_id = $2`,
      [userA, eventA],
    );
    assert.equal(saved.rows.length, 1);
    assert.equal(saved.rows[0].client_id, clientA);
    assert.equal(saved.rows[0].event_guest_id, null);
    assert.ok(Math.abs(Date.now() - Date.parse(saved.rows[0].created_at)) < 60_000);
    assert.ok(Math.abs(Date.now() - Date.parse(saved.rows[0].granted_at)) < 60_000);

    const forgedIdentity = await denied(`
      update public.ai_consents
      set client_id = '${clientB}', event_id = '${eventB}', event_guest_id = '${guestId}', created_at = '2099-01-01'
      where auth_user_id = '${userA}' and event_id = '${eventA}'
    `);
    assert.match(forgedIdentity, /identity cannot be changed/i);

    await db.exec(`
      update public.ai_consents set granted_at = '2000-01-01'
      where auth_user_id = '${userA}' and event_id = '${eventA}'
    `);
    const stamped = await db.query<{ granted_at: string }>(
      `select granted_at::text from public.ai_consents where auth_user_id = $1 and event_id = $2`,
      [userA, eventA],
    );
    assert.ok(Math.abs(Date.now() - Date.parse(stamped.rows[0].granted_at)) < 60_000);

    await asUser(userB);
    await db.exec("set role authenticated");
    const hidden = await db.query<{ n: number }>(
      `select count(*)::int as n from public.ai_consents where event_id = '${eventA}'`,
    );
    assert.equal(hidden.rows[0].n, 0);
    const ownUpdate = await denied(`
      update public.ai_consents set client_id = '${clientB}' where auth_user_id = '${userA}'
    `);
    assert.match(ownUpdate, /permission denied/i);

    await asUser(userA);
    const own = await db.query<{ n: number }>(`select count(*)::int as n from public.ai_consents`);
    assert.equal(own.rows[0].n, 2);

    await asUser(userStaff);
    const staffRead = await db.query<{ n: number }>(`select count(*)::int as n from public.ai_consents`);
    assert.equal(staffRead.rows[0].n, 2);
    await db.exec("reset role");

    await db.exec("set role service_role");
    await db.exec(`
      select public.ai_consent_save('${userA}', '${eventA}', 'withdraw', '2026-11-06', 'app')
    `);
    await db.exec("reset role");
    const withdrawn = await db.query<{ granted_at: string; withdrawn_at: string; created_at: string }>(
      `select granted_at::text, withdrawn_at::text, created_at::text
       from public.ai_consents where auth_user_id = $1 and event_id = $2`,
      [userA, eventA],
    );
    assert.ok(Date.parse(withdrawn.rows[0].withdrawn_at) >= Date.parse(withdrawn.rows[0].granted_at));
    assert.equal(withdrawn.rows[0].created_at, saved.rows[0].created_at);
  });

  it("saves SMS consent only for the booking mobile and refuses history rewrites", async () => {
    await db.exec("reset role");
    await db.exec("set role service_role");
    const noPhone = await db.query<{ saved: string | null }>(
      `select public.sms_marketing_consent_record('${userNoPhone}', null, 'grant', '2026-11-06', 'app')::text as saved`,
    );
    assert.equal(noPhone.rows[0].saved, null);
    const wrongEvent = await denied(`
      select public.sms_marketing_consent_record('${userA}', '${eventB}', 'grant', '2026-11-06', 'app')
    `);
    assert.match(wrongEvent, /not this client/i);
    const guest = await denied(`
      select public.sms_marketing_consent_record('${userGuest}', null, 'grant', '2026-11-06', 'app')
    `);
    assert.match(guest, /client account/i);

    await db.exec(`
      select public.sms_marketing_consent_record('${userA}', '${eventA}', 'grant', '2026-11-06', 'app')
    `);
    await db.exec("reset role");

    const row = await db.query<{ client_id: string; phone_e164: string; created_at: string }>(
      `select client_id, phone_e164, created_at::text from public.sms_marketing_consent_events
       where auth_user_id = $1`,
      [userA],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].client_id, clientA);
    assert.equal(row.rows[0].phone_e164, "+13055551212");
    assert.ok(Math.abs(Date.now() - Date.parse(row.rows[0].created_at)) < 60_000);

    const none = await db.query<{ n: number }>(
      `select count(*)::int as n from public.sms_marketing_consent_events where auth_user_id = '${userNoPhone}'`,
    );
    assert.equal(none.rows[0].n, 0);

    const rewrite = await denied(`
      update public.sms_marketing_consent_events
      set client_id = '${clientB}', phone_e164 = '+19995550100', created_at = '2099-01-01'
      where auth_user_id = '${userA}'
    `);
    assert.match(rewrite, /cannot be changed/i);
    const remove = await denied(`
      delete from public.sms_marketing_consent_events where auth_user_id = '${userA}'
    `);
    assert.match(remove, /cannot be changed/i);

    const forged = await denied(`
      insert into public.sms_marketing_consent_events
        (auth_user_id, client_id, event_id, phone_e164, action, disclosure_version, source, created_at)
      values ('${userA}', '${clientB}', '${eventB}', '+19995550100', 'grant', '2026-11-06', 'app', '2099-01-01')
    `);
    assert.match(forged, /does not match the account|permission denied/i);

    const wrongPhone = await denied(`
      insert into public.sms_marketing_consent_events
        (auth_user_id, client_id, phone_e164, action, disclosure_version, source)
      values ('${userA}', '${clientA}', '+19995550100', 'grant', '2026-11-06', 'app')
    `);
    assert.match(wrongPhone, /booking mobile/i);

    await asUser(userB);
    await db.exec("set role authenticated");
    const hidden = await db.query<{ n: number }>(
      `select count(*)::int as n from public.sms_marketing_consent_events`,
    );
    assert.equal(hidden.rows[0].n, 0);
    await asUser(userA);
    const own = await db.query<{ n: number }>(
      `select count(*)::int as n from public.sms_marketing_consent_events`,
    );
    assert.equal(own.rows[0].n, 1);
    await db.exec("reset role");
    await db.exec(`update public.clients set cell_phone = null where id = '${clientA}'`);
    await db.exec("set role service_role");
    await db.exec(`
      select public.sms_marketing_consent_record('${userA}', null, 'withdraw', '2026-11-06', 'app')
    `);
    await db.exec("reset role");
    const history = await db.query<{ action: string; phone_e164: string }>(
      `select action, phone_e164 from public.sms_marketing_consent_events
       where auth_user_id = $1 order by created_at`,
      [userA],
    );
    assert.deepEqual(
      history.rows.map((item) => item.action),
      ["grant", "withdraw"],
    );
    assert.equal(history.rows[1].phone_e164, "+13055551212");
    await db.exec(`update public.clients set cell_phone = '305-555-1212' where id = '${clientA}'`);
  });

  it("lets parent deletes cascade and still rejects direct history changes", async () => {
    const userFk = "abababab-abab-4aba-8aba-abababababab";
    const clientFk = "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
    const eventFk = "efefefef-efef-4efe-8efe-efefefefefef";
    const userGone = "90909090-9090-4909-8909-909090909090";
    const clientGone = "91919191-9191-4919-8919-919191919191";
    await db.exec("reset role");
    await db.exec(`
      insert into auth.users (id) values ('${userFk}'), ('${userGone}');
      insert into public.clients (id, cell_phone) values
        ('${clientFk}', '305-555-0199'),
        ('${clientGone}', '954-555-0177');
      insert into public.events (id, client_id) values ('${eventFk}', null);
      insert into public.event_clients (event_id, client_id, is_contract_holder, is_primary)
        values ('${eventFk}', '${clientFk}', true, false);
      insert into public.accounts (auth_user_id, account_type, client_id) values
        ('${userFk}', 'client', '${clientFk}'),
        ('${userGone}', 'client', '${clientGone}');
    `);
    await db.exec("set role service_role");
    await db.exec(`
      select public.sms_marketing_consent_record('${userFk}', '${eventFk}', 'grant', '2026-11-06', 'app');
      select public.sms_marketing_consent_record('${userGone}', null, 'grant', '2026-11-06', 'app');
    `);
    await db.exec("reset role");

    const directDelete = await denied(`
      delete from public.sms_marketing_consent_events where auth_user_id = '${userFk}'
    `);
    assert.match(directDelete, /cannot be changed/i);
    const directPhone = await denied(`
      update public.sms_marketing_consent_events
      set phone_e164 = '+19995550100'
      where auth_user_id = '${userFk}'
    `);
    assert.match(directPhone, /cannot be changed/i);
    const directClientNull = await denied(`
      update public.sms_marketing_consent_events
      set client_id = null
      where auth_user_id = '${userFk}'
    `);
    assert.match(directClientNull, /cannot be changed/i);
    const directEventNull = await denied(`
      update public.sms_marketing_consent_events
      set event_id = null
      where auth_user_id = '${userFk}'
    `);
    assert.match(directEventNull, /cannot be changed/i);
    await db.exec("set role service_role");
    const serviceDelete = await denied(`
      delete from public.sms_marketing_consent_events where auth_user_id = '${userFk}'
    `);
    assert.match(serviceDelete, /permission denied/i);
    await db.exec("reset role");

    await db.exec(`
      create or replace function public.consent_fk_phone_smuggle()
      returns trigger language plpgsql as $fn$
      begin
        update public.sms_marketing_consent_events
        set phone_e164 = '+19995550100'
        where client_id = old.id;
        return old;
      end;
      $fn$;
      create trigger consent_fk_phone_smuggle
        before delete on public.clients
        for each row execute function public.consent_fk_phone_smuggle();
    `);
    await db.exec(`delete from public.event_clients where client_id = '${clientFk}'`);
    const smuggle = await denied(`delete from public.clients where id = '${clientFk}'`);
    assert.match(smuggle, /cannot be changed/i);
    await db.exec(`
      drop trigger consent_fk_phone_smuggle on public.clients;
      drop function public.consent_fk_phone_smuggle();
    `);
    const intact = await db.query<{
      client_id: string;
      event_id: string;
      phone_e164: string;
      action: string;
      auth_user_id: string;
    }>(
      `select client_id, event_id, phone_e164, action, auth_user_id
       from public.sms_marketing_consent_events where auth_user_id = $1`,
      [userFk],
    );
    assert.equal(intact.rows.length, 1);
    assert.equal(intact.rows[0].client_id, clientFk);
    assert.equal(intact.rows[0].event_id, eventFk);
    assert.equal(intact.rows[0].phone_e164, "+13055550199");
    assert.equal(intact.rows[0].action, "grant");

    await db.exec(`delete from public.clients where id = '${clientFk}'`);
    const afterClient = await db.query<{
      client_id: string | null;
      event_id: string | null;
      phone_e164: string;
      action: string;
      auth_user_id: string;
      created_at: string;
    }>(
      `select client_id, event_id, phone_e164, action, auth_user_id, created_at::text
       from public.sms_marketing_consent_events where auth_user_id = $1`,
      [userFk],
    );
    assert.equal(afterClient.rows[0].client_id, null);
    assert.equal(afterClient.rows[0].event_id, eventFk);
    assert.equal(afterClient.rows[0].phone_e164, "+13055550199");
    assert.equal(afterClient.rows[0].action, "grant");
    assert.equal(afterClient.rows[0].auth_user_id, userFk);

    await db.exec(`delete from public.events where id = '${eventFk}'`);
    const afterEvent = await db.query<{ client_id: string | null; event_id: string | null; phone_e164: string; action: string }>(
      `select client_id, event_id, phone_e164, action
       from public.sms_marketing_consent_events where auth_user_id = $1`,
      [userFk],
    );
    assert.equal(afterEvent.rows[0].client_id, null);
    assert.equal(afterEvent.rows[0].event_id, null);
    assert.equal(afterEvent.rows[0].phone_e164, "+13055550199");
    assert.equal(afterEvent.rows[0].action, "grant");

    const beforeAuth = await db.query<{ n: number }>(
      `select count(*)::int as n from public.sms_marketing_consent_events where auth_user_id = '${userGone}'`,
    );
    assert.equal(beforeAuth.rows[0].n, 1);
    await db.exec(`delete from auth.users where id = '${userGone}'`);
    const afterAuth = await db.query<{ consent: number; account: number }>(
      `select
         (select count(*)::int from public.sms_marketing_consent_events where auth_user_id = '${userGone}') as consent,
         (select count(*)::int from public.accounts where auth_user_id = '${userGone}') as account`,
    );
    assert.equal(afterAuth.rows[0].consent, 0);
    assert.equal(afterAuth.rows[0].account, 0);
    const kept = await db.query<{ n: number }>(
      `select count(*)::int as n from public.sms_marketing_consent_events where auth_user_id = '${userFk}'`,
    );
    assert.equal(kept.rows[0].n, 1);
  });
});

describe("report and block identity under the authenticated Data API", { timeout: 60_000 }, () => {
  let db: PGlite;
  const songId = "88888888-8888-4888-8888-888888888888";

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
      create table public.clients (id uuid primary key);
      create table public.events (id uuid primary key, client_id uuid, cover_photo_url text);
      create table public.event_clients (
        event_id uuid, client_id uuid, is_contract_holder boolean default false, is_primary boolean default false
      );
      create table public.event_guests (id uuid primary key, event_id uuid);
      create table public.accounts (
        auth_user_id uuid primary key, account_type text, client_id uuid, event_guest_id uuid
      );
      create table public.employees (id uuid primary key default gen_random_uuid(), auth_user_id uuid);
      create table public.event_app_members (event_id uuid, auth_user_id uuid, role text);
      create table public.planning_songs (id uuid primary key, event_id uuid, requested_by uuid);
      create table public.planning_song_likes (song_id uuid, account_id uuid);
      create table public.planning_question_answers (id uuid, event_id uuid, answered_by uuid);
      create table public.song_ideas (id uuid, event_id uuid, added_by uuid);
      create table public.planning_sections (
        id uuid primary key, event_id uuid, title text, sort_order int, guest_enabled boolean,
        client_editable boolean, locked boolean, deleted_by_host boolean, deleted_by_host_at timestamptz,
        client_notes text
      );
      create table public.planning_do_not_play_notes (event_id uuid primary key, updated_by uuid);
      create table public.event_photobooth_selection (event_id uuid primary key, updated_by uuid);
      create table public.event_files (id uuid primary key, event_id uuid, source text);
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
      grant execute on function public.xos_is_staff() to anon, authenticated, service_role;
      create function public.xos_is_host(p_event_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select public.xos_is_staff()
          or exists (
            select 1 from public.accounts a
            where a.auth_user_id = auth.uid() and a.account_type = 'client'
              and exists (select 1 from public.events e where e.id = p_event_id and e.client_id = a.client_id)
          )
          or exists (
            select 1 from public.event_app_members m
            where m.event_id = p_event_id and m.auth_user_id = auth.uid() and m.role = 'host'
          );
      $$;
      create function public.xos_guest_of(p_event_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select not public.xos_is_staff()
          and not public.xos_is_host(p_event_id)
          and exists (
            select 1 from public.event_app_members m
            where m.event_id = p_event_id and m.auth_user_id = auth.uid() and m.role = 'guest'
          );
      $$;
      grant execute on function public.xos_is_host(uuid) to authenticated, service_role;
      grant execute on function public.xos_guest_of(uuid) to authenticated, service_role;
      insert into auth.users (id) values ('${userA}'), ('${userB}'), ('${userStaff}');
      insert into public.clients (id) values ('${clientA}'), ('${clientB}');
      insert into public.events (id, client_id) values ('${eventA}', '${clientA}'), ('${eventB}', '${clientB}');
      insert into public.accounts (auth_user_id, account_type, client_id) values
        ('${userA}', 'client', '${clientA}'),
        ('${userB}', 'client', '${clientB}'),
        ('${userStaff}', 'staff', null);
    `);
    await db.exec(read("supabase/migrations/00216_event_ugc_moderation.sql"));
    await db.exec(`
      grant select on public.accounts, public.events, public.event_clients, public.event_guests, public.event_app_members
      to authenticated, service_role;
    `);
  });

  async function denied(sql: string): Promise<string> {
    try {
      await db.exec(sql);
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async function asUser(userId: string) {
    await db.exec("reset role");
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
    await db.exec("set role authenticated");
  }

  it("rejects a forged reporter, target event, timestamp, and service-role insert", async () => {
    await asUser(userB);
    const crossEvent = await denied(`
      insert into public.event_content_reports
        (event_id, reporter_id, target_type, target_id, reason, created_at)
      values ('${eventA}', '${userB}', 'song', '${songId}', 'spam', '2099-01-01')
    `);
    assert.match(crossEvent, /not on that event|permission denied/i);

    const impersonate = await denied(`
      insert into public.event_content_reports
        (event_id, reporter_id, target_type, target_id, reason)
      values ('${eventB}', '${userA}', 'song', '${songId}', 'spam')
    `);
    assert.match(impersonate, /signed-in member/i);

    await asUser(userA);
    await db.exec(`
      insert into public.event_content_reports
        (event_id, reporter_id, target_type, target_id, reason, created_at)
      values ('${eventA}', '${userA}', 'song', '${songId}', 'spam', '2099-01-01')
    `);
    await db.exec("reset role");
    const saved = await db.query<{ created_at: string; status: string }>(
      `select created_at::text, status from public.event_content_reports where reporter_id = $1`,
      [userA],
    );
    assert.equal(saved.rows.length, 1);
    assert.equal(saved.rows[0].status, "open");
    assert.ok(Math.abs(Date.now() - Date.parse(saved.rows[0].created_at)) < 60_000);

    await asUser(userStaff);
    const moved = await denied(`
      update public.event_content_reports
      set reporter_id = '${userB}', event_id = '${eventB}', created_at = '2099-01-01'
      where reporter_id = '${userA}'
    `);
    assert.match(moved, /identity cannot be changed/i);
    await db.exec(`
      update public.event_content_reports
      set status = 'resolved', resolved_at = '2000-01-01', resolved_by = '${userA}'
      where reporter_id = '${userA}'
    `);
    await db.exec("reset role");
    const resolved = await db.query<{ status: string; resolved_by: string; resolved_at: string; reporter_id: string }>(
      `select status, resolved_by, resolved_at::text, reporter_id from public.event_content_reports`,
    );
    assert.equal(resolved.rows[0].status, "resolved");
    assert.equal(resolved.rows[0].resolved_by, userStaff);
    assert.equal(resolved.rows[0].reporter_id, userA);
    assert.ok(Math.abs(Date.now() - Date.parse(resolved.rows[0].resolved_at)) < 60_000);

    await db.exec("reset role");
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.exec("set role service_role");
    const serviceInsert = await denied(`
      insert into public.event_content_reports
        (event_id, reporter_id, target_type, target_id, reason)
      values ('${eventA}', '${userA}', 'song', '${songId}', 'other')
    `);
    assert.match(serviceInsert, /signed-in member/i);
    await db.exec("reset role");
  });

  it("rejects a block filed for another member or another event", async () => {
    const stranger = "12121212-1212-4212-8212-121212121212";
    await db.exec("reset role");
    await db.exec(`insert into auth.users (id) values ('${stranger}')`);
    await db.exec(`
      insert into public.event_app_members (event_id, auth_user_id, role)
      values ('${eventA}', '${userB}', 'guest')
    `);
    await asUser(userA);
    const offEvent = await denied(`
      insert into public.event_member_blocks (event_id, blocker_id, blocked_id, created_at)
      values ('${eventA}', '${userA}', '${stranger}', '2099-01-01')
    `);
    assert.match(offEvent, /not on that event/i);
    const impersonate = await denied(`
      insert into public.event_member_blocks (event_id, blocker_id, blocked_id)
      values ('${eventA}', '${userB}', '${userA}')
    `);
    assert.match(impersonate, /signed-in member/i);
    await db.exec(`
      insert into public.event_member_blocks (event_id, blocker_id, blocked_id, created_at)
      values ('${eventA}', '${userA}', '${userB}', '2099-01-01')
    `);
    await db.exec("reset role");
    const row = await db.query<{ created_at: string }>(
      `select created_at::text from public.event_member_blocks where blocker_id = $1`,
      [userA],
    );
    assert.equal(row.rows.length, 1);
    assert.ok(Math.abs(Date.now() - Date.parse(row.rows[0].created_at)) < 60_000);

    await db.exec("reset role");
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.exec("set role service_role");
    const serviceBlock = await denied(`
      insert into public.event_member_blocks (event_id, blocker_id, blocked_id)
      values ('${eventA}', '${userA}', '${userB}')
    `);
    assert.match(serviceBlock, /signed-in member/i);
    await db.exec("reset role");
  });
});
