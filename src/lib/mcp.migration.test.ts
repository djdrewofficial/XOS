import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("mcp migration guards", { timeout: 60_000 }, () => {
  let db: PGlite;

  before(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.events (
        id uuid primary key,
        name text,
        client_id uuid
      );
      create table public.payments (
        id uuid primary key,
        event_id uuid references public.events(id) on delete set null,
        amount numeric
      );
      create table public.event_clients (
        id uuid primary key,
        event_id uuid not null references public.events(id) on delete cascade,
        client_id uuid,
        is_primary boolean not null default false
      );
      create table public.email_log (id uuid primary key, status text, body_html text, event_id uuid);
      create table public.sms_log (id uuid primary key, status text, body text, event_id uuid);
      create table public.rate_limit_hits (
        id bigint generated always as identity primary key,
        bucket text not null,
        key text not null,
        created_at timestamptz not null default now()
      );
    `);
    await db.exec(read("supabase/migrations/00217_mcp_service_access.sql"));
    await db.exec(read("supabase/migrations/00218_mcp_approval_and_guards.sql"));
    await db.exec(read("supabase/migrations/00219_mcp_operations.sql"));
    await db.exec(read("supabase/migrations/00220_mcp_held_outbox.sql"));
    await db.exec(read("supabase/migrations/00221_mcp_held_effects.sql"));
  });

  it("rejects an idempotency key shorter than 8 characters", async () => {
    const token = "99999999-9999-4999-8999-999999999999";
    await db.exec(`insert into public.mcp_service_tokens (id, name, token_prefix, token_hash, scopes) values ('${token}', 'bot', 'xos_mcp_test', repeat('ab', 32), '{}')`);
    await assert.rejects(
      () => db.exec(`insert into public.mcp_idempotency_keys (token_id, idempotency_key, tool_name, args_hash, response) values ('${token}', 'pay-1', 'payments_add', repeat('c', 64), '{}')`),
      /check|constraint/i,
    );
  });

  it("does not let anon read service tokens", async () => {
    await db.exec("set role anon");
    try {
      await assert.rejects(() => db.query("select * from public.mcp_service_tokens"), /permission denied/i);
    } finally {
      await db.exec("reset role");
    }
  });

  it("refuses to delete an event that still has a payment", async () => {
    await db.exec(`
      insert into public.events (id, name) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Wedding');
      insert into public.payments (id, event_id, amount) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 10);
    `);
    await assert.rejects(
      () => db.exec("delete from public.events where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'"),
      /restrict|foreign key|violates/i,
    );
    const left = await db.query("select event_id from public.payments");
    assert.equal((left.rows[0] as { event_id: string }).event_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    const def = await db.query("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'payments_event_id_fkey'");
    assert.match(String((def.rows[0] as { def: string }).def), /on delete restrict/i);
  });

  it("does not delete a membership that belongs to another event", async () => {
    await db.exec(`
      insert into public.events (id, name) values
        ('11111111-1111-4111-8111-111111111111', 'A'),
        ('22222222-2222-4222-8222-222222222222', 'B');
      insert into public.event_clients (id, event_id, client_id, is_primary) values
        ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', true),
        ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', false),
        ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', true),
        ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', false);
    `);
    await assert.rejects(
      () => db.exec("select public.mcp_remove_event_client('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555')"),
      /not on this event/i,
    );
    const still = await db.query("select count(*)::int as n from public.event_clients where id = '55555555-5555-4555-8555-555555555555'");
    assert.equal((still.rows[0] as { n: number }).n, 1);
  });

  it("claims an operation once and refuses an inactive token", async () => {
    const token = "88888888-8888-4888-8888-888888888888";
    const user = "77777777-7777-4777-8777-777777777777";
    await db.exec(`
      insert into public.mcp_service_tokens (id, name, token_prefix, token_hash, scopes, expires_at)
      values ('${token}', 'bot', 'xos_mcp_test', repeat('cd', 32), '{}', now() - interval '1 day');
      insert into public.mcp_confirmations (id, token_id, tool_name, args_hash, args, preview, expires_at, idempotency_key)
      values ('${user}', '${token}', 'payments_add', repeat('e', 64), '{}', '{}', now() + interval '1 hour', 'op-key-1234');
    `);
    await assert.rejects(() => db.query(`select public.mcp_claim_operation('${user}', '${user}')`), /token inactive/i);
  });

  it("merges venues in one function while the survivor is locked", async () => {
    await db.exec(`
      create table if not exists public.venues (id uuid primary key, name text, city text);
      alter table public.events add column if not exists venue_id uuid;
      create table if not exists public.inquiry_sources (id uuid primary key, venue_id uuid, name text);
      create table if not exists public.venue_contacts (id uuid primary key, venue_id uuid, name text);
      create table if not exists public.venue_rooms (id uuid primary key, venue_id uuid, name text);
      create table if not exists public.venue_djep_map (id uuid primary key, venue_id uuid);
      insert into public.venues (id, name) values
        ('12121212-1212-4121-8121-121212121212', 'Keep'),
        ('13131313-1313-4131-8131-131313131313', 'Drop');
      update public.events set venue_id = '13131313-1313-4131-8131-131313131313' where id = '11111111-1111-4111-8111-111111111111';
    `);
    await db.exec(`select public.mcp_merge_venues('12121212-1212-4121-8121-121212121212', array['13131313-1313-4131-8131-131313131313']::uuid[], '{}'::jsonb)`);
    const left = await db.query("select venue_id from public.events where id = '11111111-1111-4111-8111-111111111111'");
    assert.equal((left.rows[0] as { venue_id: string }).venue_id, "12121212-1212-4121-8121-121212121212");
    const dropped = await db.query("select count(*)::int as n from public.venues where id = '13131313-1313-4131-8131-131313131313'");
    assert.equal((dropped.rows[0] as { n: number }).n, 0);
  });

  it("adds a client and toggles the contract holder under the event lock", async () => {
    await db.exec(`
      alter table public.event_clients add column if not exists role text;
      alter table public.event_clients add column if not exists is_contract_holder boolean;
      alter table public.event_clients alter column id set default gen_random_uuid();
      insert into public.events (id, name) values ('abababab-abab-4bab-8bab-abababababab', 'Membership')
      on conflict (id) do nothing;
    `);
    await db.query(`select public.mcp_add_event_client('abababab-abab-4bab-8bab-abababababab', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Bride') as id`);
    const second = await db.query(`select public.mcp_add_event_client('abababab-abab-4bab-8bab-abababababab', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Groom') as id`);
    const rows = await db.query(`select client_id, is_primary, role from public.event_clients where event_id = 'abababab-abab-4bab-8bab-abababababab' order by is_primary desc`);
    assert.equal((rows.rows[0] as { is_primary: boolean }).is_primary, true);
    assert.equal((rows.rows[1] as { is_primary: boolean }).is_primary, false);
    const event = await db.query(`select client_id from public.events where id = 'abababab-abab-4bab-8bab-abababababab'`);
    assert.equal((event.rows[0] as { client_id: string }).client_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    await db.exec(`select public.mcp_set_primary_client('abababab-abab-4bab-8bab-abababababab', '${(second.rows[0] as { id: string }).id}')`);
    const primary = await db.query(`select client_id from public.events where id = 'abababab-abab-4bab-8bab-abababababab'`);
    assert.equal((primary.rows[0] as { client_id: string }).client_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2");
    const flags = await db.query(`select is_primary from public.event_clients where event_id = 'abababab-abab-4bab-8bab-abababababab' and client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'`);
    assert.equal((flags.rows[0] as { is_primary: boolean }).is_primary, false);
    await db.exec(`select public.mcp_toggle_contract_holder('abababab-abab-4bab-8bab-abababababab', '${(second.rows[0] as { id: string }).id}', true)`);
    const holder = await db.query(`select is_contract_holder from public.event_clients where id = '${(second.rows[0] as { id: string }).id}'`);
    assert.equal((holder.rows[0] as { is_contract_holder: boolean }).is_contract_holder, true);
    await assert.rejects(
      () => db.exec(`select public.mcp_toggle_contract_holder('abababab-abab-4bab-8bab-abababababab', '55555555-5555-4555-8555-555555555555', true)`),
      /not on this event/i,
    );
  });

  it("holds new outbox rows only while the approval flag is on", async () => {
    await db.exec(`select set_config('xos.approval_hold', 'on', false)`);
    await db.exec(`insert into public.email_log (id, status, body_html) values ('abababab-abab-4bab-8bab-ababababab11', 'queued', 'held body')`);
    await db.exec(`select set_config('xos.approval_hold', 'off', false)`);
    await db.exec(`insert into public.email_log (id, status, body_html) values ('abababab-abab-4bab-8bab-ababababab22', 'queued', 'normal body')`);
    const held = await db.query(`select status from public.email_log where id = 'abababab-abab-4bab-8bab-ababababab11'`);
    const normal = await db.query(`select status from public.email_log where id = 'abababab-abab-4bab-8bab-ababababab22'`);
    assert.equal((held.rows[0] as { status: string }).status, "held");
    assert.equal((normal.rows[0] as { status: string }).status, "queued");
    const claimable = await db.query(`select count(*)::int as n from public.email_log where status = 'queued'`);
    assert.equal((claimable.rows[0] as { n: number }).n, 1);
  });

  it("claims the exact held rows or none of them", async () => {
    const email = "12121212-1212-4121-8121-121212121221";
    const sms = "12121212-1212-4121-8121-121212121222";
    const effect = "12121212-1212-4121-8121-121212121223";
    await db.exec(`
      insert into public.email_log (id, status, body_html) values ('${email}', 'held', 'notice');
      insert into public.sms_log (id, status, body) values ('${sms}', 'held', 'text');
      insert into public.mcp_held_effects (id, event_id, kind, payload, status)
      values ('${effect}', '11111111-1111-4111-8111-111111111111', 'webhook', '{"webhook_url":"https://hooks.example/x"}', 'held');
    `);
    await assert.rejects(
      () => db.exec(`select public.mcp_claim_held(array['${email}','12121212-1212-4121-8121-121212121299']::uuid[], array['${sms}']::uuid[], array['${effect}']::uuid[])`),
      /held rows changed/i,
    );
    const still = await db.query(`select status from public.email_log where id = '${email}'`);
    assert.equal((still.rows[0] as { status: string }).status, "held");
    await db.exec(`select public.mcp_claim_held(array['${email}']::uuid[], array['${sms}']::uuid[], array['${effect}']::uuid[])`);
    const after = await db.query(`select status from public.email_log where id = '${email}'`);
    assert.equal((after.rows[0] as { status: string }).status, "sending");
    const hook = await db.query(`select status from public.mcp_held_effects where id = '${effect}'`);
    assert.equal((hook.rows[0] as { status: string }).status, "sending");
  });

  it("does not select a booking helper updated_at column the migrations never added", () => {
    const initial = read("supabase/migrations/00001_initial_schema.sql");
    const helper = initial.slice(initial.indexOf("create table booking_helpers"), initial.indexOf("create table booking_helper_runs"));
    const template = initial.slice(initial.indexOf("create table email_templates"), initial.indexOf("create table email_log"));
    assert.equal(helper.includes("updated_at"), false);
    assert.equal(template.includes("updated_at"), false);
    const effects = read("src/lib/mcp/effects.ts");
    assert.equal(effects.includes('select("id, title, updated_at'), false);
    assert.equal(effects.includes('select("id, name, updated_at'), false);
  });
});
