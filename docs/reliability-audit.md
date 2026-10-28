# XOS reliability audit

Drew's report: buttons sometimes take a long time to do anything, and sometimes do nothing until a full page refresh. This is a code-level walkthrough of the staff app, the client portal, and the public sign / pay / proposal flows. Findings are ordered by how directly they cause that symptom.

Nothing in this audit was applied to the production database. New indexes and the three RLS tweaks are in a migration file for Drew to approve and run.

## What actually makes clicks feel dead

Three shared mechanisms stack on every event-page button:

1. **Event tabs fully prefetch every other tab.** `UrlTabs` set `prefetch` (which is `prefetch={true}`). In Next.js 16 that means a full dynamic render, not just the loading shell. Opening an event queues one server render per tab (Client, Details, Booking, Financials, Staff, Vendors, Logistics, Documents, Comms, Planning). Each render runs middleware plus the event page's ~40 queries. The browser only allows a handful of connections to the app at once, so the Save POST waits behind that stampede. When the queue gets stuck, further clicks do nothing until a refresh clears it.
2. **Middleware does a session refresh and several database reads before the button's server action starts, and used to drop the refreshed cookies on redirect.** `supabase.auth.getUser()` runs on every matched request, including server actions. The permission gate then queried `accounts`, then `employees`, then MFA, then permission tables, one after another. Redirects (`/login`, `/portal`, `/2fa`, `/account/security`, `/no-access`) returned a new `NextResponse.redirect` that did not copy the cookies `getUser()` had just rotated. Supabase refresh tokens are single-use. Losing the new cookies makes the next request fail or hang until a full reload.
3. **There was no loading UI.** The app had zero `loading.tsx` files, and tab links did not show a pending state. A click that is waiting on the network looks identical to a click that was ignored.

Saving an event also re-ran the whole event page (every tab's data) because actions call `revalidatePath(/events/[id])`. That is correct, but it was multiplied by the prefetch storm and by data the open tab does not need.

## Findings

### 1. Event tab prefetch storm — critical

- **Screen:** any event (`/events/[id]`), every tab and every save, archive, note, payment, or booking-helper click on that page.
- **Symptom:** the click sits there; sometimes nothing happens until refresh.
- **Cause:** `src/components/UrlTabs.tsx` passed `prefetch` on every tab `Link`. The event page (`src/app/(app)/events/[id]/page.tsx`) loads a large parallel batch plus a second sequential batch on every one of those requests. `revalidatePath` after a save invalidates the prefetched copies, so they all start again.
- **Fix:** tab links use `prefetch={false}` and show a spinner while the click is in flight (`src/components/UrlTabLink.tsx`). The open tab is the only render.
- **PR:** request-path (`cursor/reliability-request-path-9d43`).

### 2. Middleware drops refreshed session cookies — critical

- **Screen:** any redirect while the access token is being refreshed: login bounce, portal, 2FA, account security, no-access. Feels random because it only happens when Supabase rotates the refresh token during that request.
- **Symptom:** the next click fails, loops, or sits until a hard refresh. Worst case the refresh token is already burned and the session dies.
- **Cause:** `src/middleware.ts` wrote rotated cookies onto `response`, then returned a different `NextResponse.redirect(...)`.
- **Fix:** every response the middleware returns, including redirects, gets those cookies copied onto it (with the original cookie options).
- **PR:** request-path.

### 3. Middleware permission lookups on every click — high

- **Screen:** every staff navigation and every server action.
- **Symptom:** each click pays for `auth.getUser()` plus three to five sequential database round trips before the action runs. The same work was repeated by the layout (`getMe`) and again by the page.
- **Cause:** `src/middleware.ts` (sequential `accounts` → `employees` → permissions) and uncached `getMe` / `createClient` (`src/lib/auth.ts`, `src/lib/supabase/server.ts`). The event page also called `auth.getUser()` and `getMe()` separately (`src/app/(app)/events/[id]/page.tsx`).
- **Fix:** `accounts` and `employees` load in parallel. A 60-second httpOnly HMAC cookie (`xos_access`, `src/lib/permSnapshot.ts`) skips the permission queries on the requests after the first. The signature key is `SUPABASE_SERVICE_ROLE_KEY` or, if that is absent, `CRON_SECRET` (both already used server-side). If neither is set, the cache stays off. `getMe` and `createClient` are wrapped in React `cache()` so one render shares one client and one identity lookup. Server actions still call `getMe()` against the database; the cookie is only the route gate. RLS is unchanged. A permission edit takes effect within 60 seconds.
- **Drew:** no new env var if the service role key or cron secret is already on Netlify, which it is. No database change.
- **PR:** request-path. The duplicate `getUser` on the event page itself is removed in the query PR.

### 4. No feedback while a page is loading — high

- **Screen:** sidebar and any staff navigation (Events, Clients, Payments, Inbox, Settings, …).
- **Symptom:** the old page sits unchanged, so a slow route looks like a dead click.
- **Cause:** no `loading.tsx` anywhere under `src/app`.
- **Fix:** `src/app/(app)/loading.tsx` shows "Loading…" as soon as the navigation starts. Tab switches use the spinner in finding 1 (a `loading.tsx` does not cover `?tab=` on the same page).
- **PR:** request-path.

### 5. Event page refetches every tab's data on every save — high

- **Screen:** event detail, all tabs.
- **Symptom:** a note, a date, or a payment still waits on venue lists, equipment catalogs, Fireflies, Spotify, deleted payments, photo-booth images, and file signing even when that tab is not open. Counts for the tab badges stay correct only if the cheap rows stay loaded.
- **Cause:** `src/app/(app)/events/[id]/page.tsx` runs ~34 queries in one batch, then more sequential queries (planning templates, deleted payments, Spotify, photo booth, file labels, client logins) before it looks at `?tab=`. Only signed file URLs and Fireflies were gated.
- **Fix:** catalogs and tab-only queries run only for the open tab. Badge counts (clients, staff, vendors, equipment, documents, balance, comms) stay in the shared batch. The remaining extra queries run together instead of one after another. The header, booking-helper bar, and signing checklist still load what they render on every tab.
- **PR:** query performance (`cursor/reliability-query-performance-9d43`).

### 6. Dashboard and event identity looked up again — high

- **Screen:** home dashboard, and the event page delete/archive footer.
- **Symptom:** extra auth and employee queries on the two screens Drew lives in. The event footer treated a failed employee lookup as Master Admin, so Delete could appear for the wrong person if that query failed.
- **Cause:** `src/app/(app)/page.tsx` and `src/components/dashboard/widgets.tsx` (`MyUpcomingEvents`) each called `auth.getUser()` plus `employees`, ignoring the layout's `getMe()`. The event page did the same at the top and called `getMe()` again later.
- **Fix:** those screens use `getMe()` (cached per request). Delete is shown only when the resolved role is `master_admin`. The owner's break-glass path in `getMe` is unchanged.
- **PR:** query performance.

### 7. Other screens stay stale after a save — high

- **Screen:** dashboard calendar and stat cards, events list, Payments → Scheduled / Outstanding / Summary / Monthly, the event Documents tab, payroll, the client page after a password reset, the portal after the social prompt, staff views after a client confirms a proposal.
- **Symptom:** the save worked, but the other screen shows the old numbers until a hard refresh. Dashboard stat cards count by inquiry date and booked date, so editing those dates on the event and going home looked broken.
- **Cause:** `revalidatePath("/payments")` does not cover `/payments/scheduled` and the other subpages. Many event actions only revalidated `/events/[id]`. `generateDocument` revalidated `/documents` and redirected away, leaving the event tab stale. `selfCheckInOut` revalidated `/` but not the event. `saveSocialHandles` and `resetClientPassword` did not revalidate. `confirmProposal` did not revalidate the staff event.
- **Fix:** money edits refresh the event, the events list, the dashboard, and each payments subpage. Status, event date, booking dates, and staff assignment also refresh the dashboard. Check-in refreshes the event the assignment belongs to. Document generation, proposal confirm, client password reset, and the portal social save revalidate the screens that show that data. Custom date fields save in one delete and one upsert instead of one query per field.
- **PR:** request-path (`src/app/(app)/events/actions.ts`, `documents/actions.ts`, `clients/actions.ts`, `src/app/portal/social-actions.ts`, `src/app/proposal/[token]/actions.ts`).

### 8. Zelle "I sent it" succeeds when the server did not record it — critical

- **Screen:** public welcome payment (`/welcome/[token]`), Zelle.
- **Symptom:** the client sees "Thank you" and staff never see a pending payment.
- **Cause:** `src/components/WelcomePayment.tsx` called `setClaimed(true)` without checking `res.ok`. The pay page (`PayPageClient`) already checks.
- **Fix:** only advance on `res.ok`; show the error otherwise. The button stays disabled while the request is in flight.
- **PR:** action states (`cursor/reliability-action-states-9d43`).

### 9. Buttons that stick on "Saving…" or never show it — high

- **Screens and causes:**
  - Portal "Let's connect" (`src/components/SocialPrompt.tsx`): `saveSocialHandles` had no `try/finally`, so a thrown error left `busy` true and the modal locked.
  - Tasks → New task and task comments (`src/app/(app)/tasks/TasksView.tsx`), task rules save (`src/app/(app)/tasks/settings/RulesClient.tsx`): same missing `finally`.
  - Staff check-in / check-out (`src/components/StaffCheckIn.tsx`): submit buttons with no pending state, so a double tap queues two writes.
  - Document Re-Generate and the other plain action buttons (`src/app/(app)/documents/[id]/page.tsx`), booking-helper row actions (`src/app/(app)/settings/helpers/page.tsx`), and catalog `DeleteButton` (`src/components/DeleteButton.tsx`): no disabled state while the server action runs.
  - Event Fireflies approve / dismiss / attach (`src/components/EventFireflies.tsx`): actions fire with the buttons still enabled.
  - PayPal Smart Buttons (`src/components/PayButtons.tsx`): `working` was set on approve, not while `createOrder` was in flight, so a second click could create a second order.
- **Fix:** pending labels and disabled buttons; errors clear the busy flag and show a message instead of spinning forever.
- **PR:** action states.

### 10. Inbox thread and reply failures look like an empty or stuck conversation — high

- **Screen:** Inbox, and the event Comms tab (shared composer).
- **Symptom:** opening a thread shows a blank conversation with no error. A failed send can leave the "sending" bubble up until reload. The new-conversation client list fails silently.
- **Cause:** `src/components/InboxShell.tsx` swallows `loadThread` errors. `ReplyForm` in `src/components/MessageParts.tsx` adds an optimistic bubble and clears the box before `sendInboxReply` finishes, and nothing removes the bubble if the action throws.
- **Fix:** the thread shows an error with Retry. A failed send removes the temp bubble and puts the text back. The client list shows an error instead of an empty dropdown.
- **PR:** action states.

### 11. A few saves update the database and leave the open screen stale — medium

- **Screens:** portal People → invite a guest (`src/components/planner/PeoplePanel.tsx`); client → Erase personal data (`src/components/AnonymizeClient.tsx`).
- **Symptom:** success copy shows, the list or the locked profile does not, until refresh.
- **Cause:** the server revalidates, but the client never calls `router.refresh()`, and the local list is not updated.
- **Fix:** `router.refresh()` after a successful invite or anonymize.
- **PR:** action states.

### 12. Hot queries have no index — high (database, Drew applies it)

- **Screen:** every event open/save (notes, staff, add-ons, helper runs), the scheduled-payments report, email history on an event, payment schedule linking.
- **Cause:** production advisors and `pg_indexes` show these foreign keys with no covering index:
  - `event_notes (event_id, created_at desc)` — only the primary key exists
  - `event_staff (event_id)` and `event_staff (employee_id)` — staff list and "my upcoming events"
  - `event_addons (event_id)`
  - `scheduled_payments (event_id, seq)` and `scheduled_payments (due_date)` — the scheduled payments page filters a year of due dates and there is no index at all besides the primary key
  - `booking_helper_runs (event_id)`
  - `email_log (event_id, created_at desc)`
  - `payments (scheduled_payment_id)`
  - `event_clients (client_id)` — event_id is already indexed
- **Also on the hot path:** three RLS policies call `auth.uid()` per row (`accounts` "read own account", `device_tokens` "own device tokens", `planning_audit_log` "log write"). `accounts` is read on a middleware cache miss for every signed-in request. The fix is the documented `(select auth.uid())` form, still `to authenticated`, same expression otherwise.
- **Not in this migration:** 100 other unindexed foreign keys on cold tables, 22 multiple-permissive-policy warnings, and 11 unused indexes. Those are real advisor items but they are not what makes a button feel dead, and merging policies can change who can read a row. Left for a separate pass.
- **Fix:** `supabase/migrations/00201_reliability_indexes.sql`. **Drew runs this.** It was not applied from this audit.
- **PR:** query performance.

### 13. Relative timestamps can disagree on first paint — low

- **Screen:** notification bell, planner field history.
- **Cause:** `Date.now()` during render in `src/components/NotificationBell.tsx` and `src/components/planner/FieldHistory.tsx`.
- **Symptom:** a rare hydration warning ("just now" vs "1m ago"), not a dead button.
- **Fix:** not changed. The text is cosmetic. Forcing it client-only is a follow-up if the console warning shows up in practice.

## What was checked and is in decent shape

- Data pages already set `export const dynamic = "force-dynamic"`. No `unstable_cache` / `revalidateTag` misuse.
- `SaveButton` is inside the forms that use it, and `useFormStatus` is not mounted outside a form. Forms whose `action` is a client function still get a pending state from React 19; the gaps above are the buttons that never opted in.
- Redirecting server actions are invoked from `<form action>` or `startTransition`, not from a bare `onClick`.
- The events list itself is a single parallel batch of five queries.
- Inbox realtime still calls `setAuth` before `subscribe`, and the popstate / autocomplete listeners are cleaned up on navigation.
- Contract email still sends from the app's Send Contract / booking-helper path (`processOutbox()` in the helper action). That was not moved into the database.

## How this was verified

- Code walk of middleware, auth, the event page, dashboard widgets, payment and document actions, inbox, portal, and the public pay/welcome/proposal flows.
- Read-only production inspection: Supabase performance advisors and `pg_indexes` / `pg_policy` for the tables above. No writes, no auth changes.
- `npx tsc --noEmit`, ESLint on the touched files, and `npm run build` on each PR.
- A local Supabase stack was not started: this environment has no Docker daemon, and the CLI stack needs one. Production was not used as a click-through target, so write flows were not exercised in a browser against real data. The permission-cookie sign/verify helper was executed locally (valid token, wrong user, tampered signature, expired snapshot).

## What Drew needs to do

1. Review and merge the three PRs. Do not need a new Netlify env var for the permission cookie if `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET` is already set (it is).
2. After the query PR is merged, run `supabase/migrations/00201_reliability_indexes.sql` in the Supabase SQL editor (or `apply_migration`). It only adds indexes and recreates three policies with `(select auth.uid())`. It does not drop columns or delete rows.
3. No Mailgun, HighLevel, or PayPal change. Send Contract stays an app action.
