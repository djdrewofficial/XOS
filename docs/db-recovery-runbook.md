# XOS — Database Backup & Recovery Runbook

Owner: Drew (drew@xpressdjs.com) · Supabase project `qjnzicqvzmvwryisjvip` (XOS, us-east-1, Postgres 17)

This is the tested, do-this-when-it-breaks guide for the XOS database. Read the
**"If a migration went wrong"** section first in an emergency.

---

## GO-LIVE MUST-DO (owner: Drew — before onboarding paying clients)

These three are the real safety net and are **dashboard/account actions** (not code):

- [ ] **Turn on PITR** (§1.2) — the only protection against a mid-day migration mistake with < 24 h loss. Paid add-on (~$100/mo).
- [ ] **Stand up a separate `xos-dev` project** and point local `.env.local` at it (§4) — so `npm run dev` stops reading/writing the live prod DB.
- [ ] **Run the recovery drill once and sign off** (§5) — an untested backup is not a backup.

Then, ongoing, before every risky migration (§2): `npm run db:snapshot` **and** `npm run db:storage-snapshot`.

---

## 0. Architecture facts (why this matters)

- **One production Postgres database.** Local `npm run dev` and prod
  (xos.xpressdjs.com on Netlify) both point at the **same** Supabase project via
  `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` / Netlify env. **There is no separate
  dev database today** — a bad query run "in dev" hits real client data.
- **Migrations** are numbered SQL files in `supabase/migrations/` applied to prod
  (via the Supabase MCP `apply_migration`, or pasted into the SQL editor). They are
  **not** run through a staging DB first.
- **Storage buckets** (`event-files`, `event-photos`, `sms-media`, etc.) are **not**
  part of the Postgres backup. They have their own retention — a DB restore does
  **not** bring back deleted files. Use `npm run db:storage-snapshot` (§2) to
  capture the critical bucket (`event-files` = signed contracts / generated PDFs)
  plus a manifest of every object before risky changes.

RPO/RTO targets (what to aim for):
- **RPO** (max data loss): ≤ 24 h with daily backups; ≤ 2 min with PITR enabled.
- **RTO** (time to recover): ≤ 1 h for a full restore; ≤ 15 min for a single-table
  restore from a pre-migration snapshot.

---

## 1. Verify the safety net (do this once, then quarterly)

1. **Daily backups** — Supabase Dashboard → Project → **Database → Backups**.
   Confirm you see recent daily backups with a retention window (Pro plan = 7 days).
   If the list is empty, the project is on a plan without automated backups — upgrade
   or rely entirely on the pre-migration snapshots in §2.
2. **Point-in-Time Recovery (PITR)** — same page, **Point in Time** tab (or
   Settings → Add-ons). PITR lets you restore to any moment (down to ~2 min),
   which is the real protection against a mid-day migration mistake. It is a **paid
   add-on** (~$100/mo at the smallest tier). Turn it on if the business can't
   tolerate losing a day of bookings/payments.
3. Current posture (recorded state):
   - **Daily backups: ON** — confirmed by Drew, 2026-07-31. RPO = up to 24 h.
   - **PITR: OFF** — ⚠️ **go-live blocker** (see checklist at top). Daily backups +
     the §2 pre-migration snapshots are the interim net, but that's up to 24 h of
     lost bookings/payments on a bad mid-day migration.
   - **Dev = prod DB** — ⚠️ **go-live blocker**; no separate dev project yet, so a
     bad local query hits real client data. Interim mitigation: snapshots before
     risky migrations. Fix = stand up `xos-dev` (§4).
   - **Storage backup: tooling added** — `npm run db:storage-snapshot` captures
     signed contracts (`event-files`) + a full manifest. Run it alongside
     `db:snapshot` before risky changes (it's not automatic).
   - **Recovery drill: NOT yet run** — ⚠️ **go-live blocker** (§5 sign-off blank).

---

## 2. BEFORE any risky migration — take a snapshot

Any migration that `DROP`s, `ALTER`s a column type, deletes rows, or rewrites a
big function: snapshot first. It's cheap insurance and gives you a 15-minute
single-table restore path even without PITR.

```bash
# from the repo root, with the DB connection string exported (see below)
npm run db:snapshot
```

This writes a timestamped schema+data dump to `backups/` (git-ignored). It uses the
Supabase CLI under the hood, so no local Postgres client tools are required.

**Also snapshot Storage** — the Postgres dump does not include buckets, so a DB
restore won't bring back signed contracts / PDFs:

```bash
# needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY exported
npm run db:storage-snapshot            # manifest all buckets + download event-files (contracts/PDFs)
npm run db:storage-snapshot -- --all   # also download photos/media (large)
```

This writes `backups/storage/<timestamp>/manifest.json` (every object in every
bucket) and downloads the critical `event-files` bucket, so signed agreements are
recoverable independently of the DB.

Get the connection string once: Supabase Dashboard → **Project Settings → Database
→ Connection string → URI** (the `postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres`
form). Export it (do NOT commit it):

```bash
# PowerShell
$env:SUPABASE_DB_URL = "postgresql://postgres:<password>@db.qjnzicqvzmvwryisjvip.supabase.co:5432/postgres"
# bash
export SUPABASE_DB_URL="postgresql://postgres:<password>@db.qjnzicqvzmvwryisjvip.supabase.co:5432/postgres"
```

Schema-only (faster, good for structural migrations):

```bash
npm run db:snapshot -- --schema-only
```

---

## 3. If a migration went wrong (the common emergency)

Work top-down; stop at the first option that fits.

**A. The migration only changed a FUNCTION/policy (no data touched)** — safest case.
Re-apply a corrected `CREATE OR REPLACE FUNCTION` / policy migration. No restore
needed. (Most XOS migrations are this — e.g. `render_merge_tags`.)

**B. It corrupted/deleted rows in ONE or a FEW tables, and you have a §2 snapshot**
1. From `backups/<timestamp>.sql`, extract just the affected table(s).
2. In the SQL editor: `BEGIN;` → restore the table (truncate + re-insert from the
   snapshot, or `COPY`), eyeball a few rows, then `COMMIT;` (or `ROLLBACK;`).
3. Re-run any dependent triggers/materialized recalcs if needed.

**C. Broad corruption, PITR is ON** — best full-recovery path.
1. Dashboard → Database → Backups → **Point in Time**.
2. Pick a timestamp **just before** the bad migration ran (check
   `supabase/migrations` file mtime or the SQL editor history for the exact minute).
3. Restore. Supabase provisions the DB to that instant. Confirm app health, then
   re-apply any *good* migrations that ran after that point.

**D. Broad corruption, only daily backups** — last resort, up to 24 h loss.
1. Dashboard → Database → Backups → restore the most recent daily backup from
   **before** the mistake.
2. Everything after that backup is lost — manually re-enter/notify for any bookings
   or payments taken in the gap (cross-check Mailgun/HighLevel/PayPal records).

**In all cases:** after restoring, re-run the Supabase **security advisor** and a
smoke test (`/events` loads, a test event opens, a merge-tag renders) before
declaring done.

> Storage files are separate: if a migration/script deleted rows that referenced
> `event-files`/`event-photos` objects, the objects themselves may still exist in
> the bucket (or may need re-upload). A DB restore does not restore Storage.

> **After ANY restore, re-verify pg_cron.** A restore can leave the `cron.job`
> table empty — the queueing engines (scheduled emails, payment reminders, daily
> status actions) then silently stop. Check with `select jobname, schedule, active
> from cron.job;` — you should see all three. If any are missing, re-create them:
> ```sql
> select cron.schedule('xos-scheduled-emails',    '*/15 * * * *', 'select run_scheduled_emails()');
> select cron.schedule('xos-payment-reminders',   '0 13 * * *',   'select run_payment_reminders()');
> select cron.schedule('xos-daily-status-actions','0 9 * * *',    'select run_daily_status_actions()');
> ```
> Safety net: the outbox cron (`/api/cron/send-outbox`, driven by an external
> scheduler independent of pg_cron) probes pg_cron's run log each minute via
> `cron_job_health()` and **backstops** any engine pg_cron has missed, plus raises a
> `system_alert` notification. So queueing keeps working even before you notice —
> but still re-schedule the jobs so timing (1 pm reminders, 9 am status) is exact.

---

## 4. Dev/prod separation (fixing "dev = prod DB")

Today local dev reads/writes the live database. Options, cheapest first:

1. **Separate dev Supabase project** (recommended) — ~$10/mo in this org (or a free
   project if the org has free-tier capacity). One-time setup, ~10 min:
   - Create project `xos-dev` in the same org (Dashboard → **New project**). Note its
     **project ref** (the `abcd…` in the project URL).
   - Apply the full schema — the Supabase CLI runs every file in
     `supabase/migrations/` in order, so a fresh project ends up at exact parity:
     ```bash
     npx --yes supabase link --project-ref <xos-dev-ref>   # prompts for the db password
     npx --yes supabase db push                            # applies all migrations
     ```
   - Seed minimal fake data (one test event/client/venue) — **never copy real PII**.
   - Point **local** `.env.local` at `xos-dev`: from the new project's
     **Settings → API**, copy Project URL + anon key + service-role key into
     `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY` (see `.env.local.example`). Leave Netlify prod env untouched.
   - Trade-off: local dev no longer shows real production data (that's the point).
2. **Supabase branches** (~$0.013/hr, ephemeral) — spin up a branch DB to test a
   migration, merge if good, tear down. Great for CI/migration rehearsal; not a
   full-time dev DB.
3. **Local Postgres** — free, fully offline, but you maintain schema parity yourself.

Whichever we pick, the rule going forward: **apply new migrations to dev first,
verify, then prod.**

---

## 5. Quarterly recovery drill (proves the runbook works)

Once a quarter, on a **branch or the dev project** (never prod):
1. Take a §2 snapshot.
2. Simulate a mistake (e.g. `update payments set amount = 0` in a transaction).
3. Recover using §3-B (single-table restore) and confirm the data is back.
4. Note the date + who ran it here: ____________________

An untested backup is not a backup. This drill is the difference between "we have
backups" and "we can restore."
