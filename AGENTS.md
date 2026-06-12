<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# XOS — Xpress Operating System

Custom CRM replacing DJ Event Planner (DJEP) for Xpress Entertainment (Drew's DJ company, South Florida).
Owner: Drew (drew@xpressdjs.com). Build fully and functionally, verify visually in the browser, explain plainly.

## Stack & Environments
- Next.js 16 App Router + React 19 + Tailwind v4 (`@theme`, brand `#4b328e` → `#8b6fd6`) + Supabase (Postgres, RLS authenticated-only, pg_cron, Storage) + Tiptap v3 editor.
- **Dev**: `npm run dev` on localhost:3000 (Drew usually has it running — NEVER run `next build` in the repo dir or delete `.next` while it runs; verify with `npx tsc --noEmit` instead).
- **Prod**: https://xos.xpressdjs.com on Netlify (project id `b566b789-6ffe-49ed-8dea-17539e5a1c96`). GitHub repo `djdrewofficial/XOS` is linked — **every push to main auto-deploys** (build runs on Netlify CI/Linux). Do NOT deploy via local CLI (Windows blocks the plugin's symlinks). Check deploys: `npx netlify api listSiteDeploys --data '{"site_id":"b566b789-6ffe-49ed-8dea-17539e5a1c96","per_page":1}'`.
- Same Supabase DB serves dev and prod (single-tenant).
- Email: Mailgun, domain **mg2.xpressdjs.com** (US). One server API key sends as anyone @xpressdjs.com (no per-user SMTP). Webhooks (delivered/opened/permanent_fail/complained) → `https://xos.xpressdjs.com/api/mailgun/webhook`. Outbox pattern: rows queue in `email_log`, `processOutbox()` (src/lib/mailgun.ts) sends; Netlify scheduled function `netlify/functions/process-outbox.mts` drains every 10 min; booking-helper runs drain immediately.
- SMS: HighLevel/GHL (LeadConnector API v2, `services.leadconnectorhq.com`). Env: `HIGHLEVEL_PI_TOKEN` (Private Integration, rotate ~90 days) + `HIGHLEVEL_LOCATION_ID`. Same outbox pattern: `sms_log` → `processSmsOutbox()` (src/lib/highlevel.ts): E.164-normalize → `/contacts/upsert` → `/conversations/messages` type SMS; drains alongside email everywhere. Helper engine v4 (migration 00041) has `send_sms` action; "Send Texts" tab in the helper editor. Replies land in the GHL Conversations inbox. Gotcha: GHL auto-sets contact-level SMS DND on Twilio errors (e.g. 30006 landline) and blocks sends with "DND is active for SMS" — check `contact.dndSettings.SMS`. Live-tested 2026-06-12.

## Migrations workflow
Numbered SQL files in `supabase/migrations/` (currently through `00041`). **Drew runs them manually in the Supabase SQL editor** — always tell him which numbers to run. Settings pages render a "One-time setup needed" card if their table is missing. Verify applied via REST probes (`?select=col&limit=1` errors on missing). All migrations through 00041 confirmed applied (2026-06-12).

## Conventions (follow these)
- **Settings pages**: DJEP-style. `src/components/SettingsForm.tsx` (Section/Row/Note/CheckBoxField/CheckGroup), brand-gradient section headers, label-left 280px. Single-row settings tables keyed `id boolean primary key default true check (id)` (company_settings, staff_settings, payment_settings, expense_settings).
- **Save buttons**: ALWAYS `src/components/SaveButton.tsx` (useFormStatus → "Saving…" → purple "✓ Saved" pulse). Add-style buttons get `savedLabel="Added"`. Catalog editors use `VersionSaveButtons` instead.
- **Versioning philosophy**: packages/addons have version history (`package_versions`/`addon_versions`); events pin price+version at assignment (`package_price_locked`, `package_version_no`, `event_addons.price_locked` — DB triggers). Price calc order everywhere: override → locked → live default. Catalog saves ask "Update Current Version" (typo fix) vs "Create New Version". Generated documents freeze content; signed documents are immutable.
- **Merge tags**: DB function `render_merge_tags(p_event_id, p_template)` (migration 00037 = latest version). Tags stored HTML-escaped (`&lt;tag&gt;`) so Tiptap preserves them. TS-side send-time tags handled in `processOutbox` enrichment: `<quote_summary>`, `<payment_plan>`, `<document_sign_link>`. Tag list UI: `MERGE_TAGS` in `src/components/RichTextEditor.tsx`.
- **Client-facing wording**: never "contract" → "Booking Agreement" (`docTypeClientLabel`); never "total price/cost" → "Investment".
- **Middleware gotcha**: `src/middleware.ts` login-walls EVERYTHING. Public routes must be added to its exemption list (currently `/sign/*`, `/api/mailgun/*`, `/api/cron/*`). Forgetting this = silent login-redirects in prod.
- Icons: Font Awesome (`@fortawesome/react-fontawesome`, free packs). Official logo SVGs: `G:\Shared drives\XE - Marketing TEAM\Xpress Entertainment LOGO\`.
- Windows + PowerShell 5.1; bash available. Read `.env.local` keys without printing secret values.

## Major systems (all live in prod)
- **Events** (`/events/[id]`): tabbed (Client/Details/Booking/Financials/Staff/Vendors/Logistics/Documents/Notes). Sticky event header at `top-14` (below the TopBar).
- **Booking helpers** (`/settings/helpers`): DB engine `run_booking_helper()` — jsonb actions (emails w/ sender identity choice, status change). Helper click queues emails AND sends instantly.
- **Email** (`/settings/email`): templates with Content/Settings/Scheduling/Visibility tabs; scheduled engine `run_scheduled_emails()` via pg_cron every 15 min (per-template send time in company timezone). Templates can **attach a document**: `attach_mode='esign_link'` (doc generated at send time, sign button/link in body) or `'pdf'` (branded PDF rendered, attached, saved to event files; prefers latest SIGNED copy). `branded_shell` toggle: ON = logo-header card wrap applied at send time; OFF = plain content for follow-up deliverability. Seeded template: "Quote — Booking Agreement (E-Sign)" (id `2360d63c-50ef-450a-9102-f0bcec80e88b`).
- **Documents** (`/documents`): block-based templates (text, section = collapsible chapter, fee_table, payment_schedule, event_details, signature, divider). Branded shell `src/components/DocumentShell.tsx` (XDOC_CSS exported, used by `src/lib/documentHtml.ts` for PDFs). Generation freezes blocks into `documents.blocks`. Booking Agreement template id `e2ae8026-0d1a-4681-be90-f130d572aec4` — 18 collapsible chapters, fully merge-tagged. Chapters auto-expand for print (beforeprint script).
- **E-sign** (`/sign/[token]`, PUBLIC route): typed-name + consent ESIGN flow, audit trail (IP/UA/timestamp/SHA-256 content hash), signature stamped into the doc, locked forever, signed-copy email, after-sign forward URL (template field), office notification. Tracking panel on the event's Documents tab reads `document_views` (migration 00035).
- **After-sign automation** (Phase 3, migration 00040): `document_templates.after_sign_helper_id` → booking helper that `signDocument()` runs the moment a client signs (failure = bell notification, never blocks the client). Seeded helper "After Sign — Booking Agreement" (status → Booked, stamps contract_signed_date/booked_date, sends "Booking Confirmation" + "Retainer Payment Request", adds note; one-shot per event) is wired to the Booking Agreement doc template. Picker: "After-Sign Automation" dropdown in the doc template editor. Merge tags `<retainer_amount>`/`<retainer_due_date>` = scheduled payment #1 (fallbacks: deposit_value / "upon signing"). E2E verified 2026-06-12.
- **PDF engine**: `src/lib/pdf.ts` (puppeteer-core + @sparticuz/chromium; local Windows uses installed Chrome). REQUIRED in next.config.ts: `serverExternalPackages` + `outputFileTracingIncludes` for the chromium `bin/**` or prod 500s. Smoke test: GET `/api/dev-pdf-test` (login-walled). `/api/dev-email-preview` previews the quote email (dev only).
- **Notifications**: top-bar bell (`NotificationBell`), `notifications` table fed by DB triggers (payments, time off, email bounces, document_signed) filtered by `company_settings.notif_types`; 60s poll, optional sound.
- **Top bar** (`TopBar.tsx`): global search (`/api/search` — pages/clients/events/venues/vendors/employees/packages) + quick-nav icons with tooltips.
- **Settings → Application** (all functional): General (timezone/phone auto-format/autocomplete/notification types/landing page/template preview event), Booking Helpers, Dashboard Layout (per-role widget builder — `dashboard_layouts` + registry `src/lib/dashboardWidgets.ts`), Event List Settings (inside the column-editor popup), Event Statuses (semantic groups + counts_financial/availability/payroll), Staff Settings (6 tabs, DJEP employee-settings parity; per-employee fields intentionally live BOTH there and on employee profiles), Payment Settings (methods/reasons/amount+reason autofill), Expenses (option lists, category chips, auto-mileage).
- **Auto-mileage**: `apply_auto_mileage()` DB trigger — booked-group status + venue.auto_mileage + distance_miles → expense, once per event. Backfill via "Apply To Existing Events". Villa Toscana is the flagship case.

## Test data
Event "Test & Demo Wedding" (id `32e79b00-bfa5-4cc1-ae4d-488b0a2fab87`), client "Test Client" (erickfisher97@gmail.com), The Xperience Package $2,450 pinned v1 + LED Dance Floor $2,100 = $4,550 total, Villa Toscana Miami. Two SIGNED Booking Agreements exist (signed docs are locked — generate fresh ones to test).

## Backlog (Drew's roadmap, in priority order)
1. **PayPal API** payments (client pays from the sign/thank-you flow; after-payment internal actions).
2. Client portal (documents `visible_to_client` flag already exists), manual compose/send-one-off email UI, employee portal features (check-in, timesheets, confirm/decline — staff_settings already stores all the config), inbox + nav counters, Custom Fields settings page (last placeholder).
