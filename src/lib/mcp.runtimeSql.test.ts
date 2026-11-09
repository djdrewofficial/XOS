import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { hideClientLinks } from "./mcp/redact.ts";
import { pdfRequestAllowed } from "./pdf.ts";
import { sniffUpload } from "./officeParity.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("runtime sql guards", () => {
  it("rejects held mail under the live check, then accepts it and runs the fixed claim and merge", async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.events (id uuid primary key, name text, client_id uuid, venue_id uuid);
      create table public.email_log (
        id uuid primary key,
        event_id uuid,
        status text not null default 'queued',
        body_html text,
        subject text
      );
      create table public.sms_log (
        id uuid primary key,
        event_id uuid,
        status text not null default 'queued',
        body text
      );
      alter table public.email_log add constraint email_log_status_check
        check (status = any (array['queued','sending','sent','delivered','opened','failed','bounced','complained','cancelled']));
      alter table public.sms_log add constraint sms_log_status_check
        check (status = any (array['queued','sending','sent','failed','cancelled','suppressed']));
      create table public.venues (
        id uuid primary key,
        name text,
        travel_fee numeric,
        is_one_time boolean,
        auto_mileage boolean,
        category_id uuid
      );
      create table public.inquiry_sources (id uuid primary key, venue_id uuid, name text);
      create table public.venue_contacts (id uuid primary key, venue_id uuid, name text);
      create table public.venue_rooms (id uuid primary key, venue_id uuid, name text);
      create table public.venue_djep_map (id uuid primary key, venue_id uuid);
      create table public.event_clients (
        id uuid primary key default gen_random_uuid(),
        event_id uuid,
        client_id uuid,
        role text,
        is_primary boolean,
        is_contract_holder boolean
      );
      create table public.mcp_confirmations (id uuid primary key, expires_at timestamptz);
      create table public.mcp_idempotency_keys (id uuid primary key, created_at timestamptz);
      create table public.mcp_audit_log (id uuid primary key, created_at timestamptz);
      create or replace function public.run_booking_helper(p_helper_id uuid, p_event_id uuid, p_sms jsonb)
      returns void language plpgsql as $fn$
      begin
        insert into public.email_log (id, event_id, status, body_html, subject)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', p_event_id, 'queued', 'hello', 'Subject');
      end $fn$;
    `);
    const ops = read("supabase/migrations/00219_mcp_operations.sql");
    const claimFn = ops.slice(ops.indexOf("create or replace function public.mcp_run_helper_claim"), ops.indexOf("revoke all on function public.mcp_run_helper_claim"));
    const mergeStart = ops.indexOf("create or replace function public.mcp_merge_venues");
    const mergeFn = ops.slice(mergeStart, ops.indexOf("revoke all on function public.mcp_merge_venues"));
    await db.exec(claimFn);
    await db.exec(mergeFn);
    await db.exec(read("supabase/migrations/00221_mcp_held_effects.sql"));
    const event = "11111111-1111-4111-8111-111111111111";
    const helper = "22222222-2222-4222-8222-222222222222";
    await db.exec(`insert into public.events (id, name) values ('${event}', 'Wedding')`);
    await assert.rejects(
      () => db.exec(`insert into public.email_log (id, status, body_html) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'held', 'notice')`),
      /23514|check constraint/i,
    );
    await assert.rejects(
      () => db.query(`select * from public.mcp_run_helper_claim('${helper}', '${event}', null)`),
      /42702|42846|ambiguous|cannot cast/i,
    );
    await db.exec(read("supabase/migrations/00222_mcp_runtime_guards.sql"));
    await db.exec(`insert into public.email_log (id, status, body_html) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'held', 'notice')`);
    const claimed = await db.query(`select channel, id, body_sha from public.mcp_run_helper_claim('${helper}', '${event}', null)`);
    assert.equal((claimed.rows[0] as { id: string }).id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    const keep = "12121212-1212-4121-8121-121212121212";
    const drop = "13131313-1313-4131-8131-131313131313";
    const category = "14141414-1414-4141-8141-141414141414";
    await db.exec(`
      insert into public.venues (id, name, travel_fee) values ('${keep}', 'Keep', 0), ('${drop}', 'Drop', 1);
      update public.events set venue_id = '${drop}' where id = '${event}';
    `);
    await db.exec(`select public.mcp_merge_venues('${keep}', array['${drop}']::uuid[], '{"travel_fee":12,"is_one_time":true,"category_id":"${category}"}'::jsonb)`);
    const venue = await db.query(`select travel_fee::text as fee, is_one_time, category_id::text as category from public.venues where id = '${keep}'`);
    assert.equal((venue.rows[0] as { fee: string }).fee, "12");
    assert.equal((venue.rows[0] as { is_one_time: boolean }).is_one_time, true);
    assert.equal((venue.rows[0] as { category: string }).category, category);
    const body = "notice";
    const sha = createHash("sha256").update(body).digest("hex");
    await assert.rejects(
      () => db.exec(`select public.mcp_claim_held(array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[], '{}'::uuid[], '{}'::uuid[], array['${"0".repeat(64)}']::text[], '{}'::text[], '{}'::text[])`),
      /held rows changed/i,
    );
    const still = await db.query(`select status from public.email_log where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'`);
    assert.equal((still.rows[0] as { status: string }).status, "held");
    await db.exec(`select public.mcp_claim_held(array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[], '{}'::uuid[], '{}'::uuid[], array['${sha}']::text[], '{}'::text[], '{}'::text[])`);
    const moved = await db.query(`select status from public.email_log where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'`);
    assert.equal((moved.rows[0] as { status: string }).status, "sending");
  });
});

describe("capability redaction and upload sniffing", () => {
  it("removes the whole signed url, not only the path prefix", () => {
    const leaked = hideClientLinks("See https://db.example/storage/v1/object/sign/event-files/event/file.pdf?token=secret-jwt");
    assert.equal(leaked, "See [client link]");
    assert.equal(String(leaked).includes("secret-jwt"), false);
  });

  it("rejects a script renamed as a png and a private pdf request", () => {
    assert.equal(sniffUpload(Buffer.from("<script>alert(1)</script>")), null);
    assert.equal(sniffUpload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
    assert.equal(pdfRequestAllowed("http://127.0.0.1/logo.png", ["xos.example"]), false);
    assert.equal(pdfRequestAllowed("https://evil.example/logo.png", ["xos.example"]), false);
    assert.equal(pdfRequestAllowed("https://xos.example/logo-dark.png", ["xos.example"]), true);
  });
});
