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
      create table public.rate_limit_hits (
        id bigint generated always as identity primary key,
        bucket text not null,
        key text not null,
        created_at timestamptz not null default now()
      );
    `);
    await db.exec(read("supabase/migrations/00217_mcp_service_access.sql"));
    await db.exec(read("supabase/migrations/00218_mcp_approval_and_guards.sql"));
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
});
