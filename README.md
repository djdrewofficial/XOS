# XOS — Xpress Entertainment Operating System

Custom back-office CRM replacing DJ Event Planner. Beta 1.

**Stack:** Next.js (App Router) · Supabase (Postgres + Auth) · Tailwind CSS

**Architecture:** XOS is the system of record for events, contracts, payments, and staffing.
GoHighLevel stays the lead/communications front end; Vibo stays the client-facing planning app;
Mailgun will handle outbound email (Beta 2). See `DJEP-Replacement-Spec.md` in the Xpress System
folder for the full specification.

## Beta 1 scope

- Email/password login (Supabase Auth), all routes protected
- Dashboard: month stats (leads / lost sales / booked / inquiries by status group), upcoming events, recent payments
- Events list with status-color rows, upcoming/past/all + per-status filters, balance due
- Event detail: financials overview, one-click status changes, payment log, **unlimited scheduled
  payments with auto-split** (DJEP capped at 3), internal notes, custom links (Drive timeline/folder, Vibo, photo booth)
- Add/edit event (details, booking dates, financials with overrides/discounts, venue, custom fields)
- Clients: search, profile with event history, add/edit
- Venues: travel/setup fees, load-in details, one-time flag, add form
- Packages & add-ons: seeded with live Xpress/Villa Toscana pricing (read-only in Beta 1)
- Payments: yearly view with monthly summary tiles (start of DJEP's Income reports)
- Statuses: the full 21-status system with semantic groups (Booked/Pending/Lost Sale/Leads)
  and the 5 daily rollover rules (runner lands in Beta 2)
- Schema includes booking_helpers / booking_helper_runs / email_templates / email_log tables —
  the engines for Beta 2

## Setup

1. **Database** — in [Supabase Studio](https://supabase.com/dashboard) → SQL Editor, run, in order:
   - `supabase/migrations/00001_initial_schema.sql`
   - `supabase/migrations/00002_seed_data.sql`
2. **Auth user** — Supabase Studio → Authentication → Users → *Add user* → create your
   email/password (e.g. drew@xpressdjs.com). Email confirmation: use "Auto Confirm".
3. **Env** — copy `.env.local.example` to `.env.local` and paste the **anon public** key from
   Supabase Studio → Settings → API.
4. **Run**
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000 and log in.

## Roadmap (from spec §7)

Beta 2: booking-helper executor + buttons on the event record, Mailgun sending + email templates,
daily-action runner (pg_cron), staff assignment UI, package/add-on CRUD, scheduled-payment pay-by-link,
DJEP data import. Phase 2: check-in/out payroll, QR equipment, funnel analytics, full report suite.
