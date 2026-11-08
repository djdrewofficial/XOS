# XOS MCP connector

Agents call XOS over a remote MCP server. There is no staff login, no browser session, and no password manager. A service token is a separate identity: a random bearer secret, stored only as a SHA-256 hash, with its own scopes.

This is not a second copy of the business rules. Contract email, booking helpers, payments, and the outbox call the same functions the office screens use.

## Why it is hosted in the Next.js app

The public site `https://xos.xpressdjs.com` sits behind Cloudflare, which has rejected automated clients. The connector must not depend on passing that check.

XOS already treats a few `/api` routes as machine endpoints. They authenticate themselves, and the Cloudflare origin lock skips them, so they answer on the raw Netlify hostname (`*.netlify.app`) where Cloudflare is not in front.

The MCP route is one of those endpoints: `POST /api/mcp`.

A Supabase Edge Function was the other option. It was not used because the send path cannot move there without reimplementing it. Contract mail renders the quote, investment, and payment plan in the Next.js process, then the outbox fills the tags the database does not know (`quote_summary`, `payment_plan`, `document_sign_link`) and attaches the Booking Agreement. Sending that from SQL alone drops those tags. The edge function also cannot run the PDF and mail code the app already runs. Putting the connector in the app lets every tool call those functions directly. Vendor credentials stay in the Netlify environment. They are not in the token, the tool list, or the audit log.

The server is stateless streamable HTTP. Each POST is one JSON-RPC message and the response is JSON. There is no session id and no SSE stream. `GET` and `DELETE` return 405.

## What a call does

1. The bearer token is hashed and looked up. Missing, unknown, revoked, expired, and rotated-past-overlap tokens are rejected. The raw token is not written to the audit log.
2. The token must hold every scope the tool requires. Anything else is denied.
3. Reads run immediately.
4. Money, deletes, client email, client texts, contract sends, and helper runs do not run on the first call. The first call returns a receipt: who would be contacted, the exact text, and the version of any template or helper. Nothing is sent or changed.
5. `xos_confirm` only reports that status. Calling it is not approval and does not run the action. A signed-in master admin opens Settings → Agent Access and approves that receipt. If a template or helper changed after the preview, approval stops and nothing runs. A chat host must still show its own draft card. The confirmation id is not that card.
6. Every call is audited: token name, tool, redacted arguments, status, timing, confirmation id.
7. A write can send `Idempotency-Key` (header or `idempotency_key` argument). The same key and the same arguments return the first result and do not run again. A different call with the same key is rejected.
8. A token is limited to 120 requests a minute and 20 actual writes a minute. Failed logins are limited per IP.

`xos_whoami` lists the token's scopes and the tools those scopes allow.

## Scopes

A new token starts with no scopes. Grant only what that agent should do.

| Scope | Allows |
| --- | --- |
| `read.events` / `write.events` | Events |
| `read.clients` / `write.clients` | Clients |
| `read.venues` / `write.venues` | Venues |
| `read.vendors` / `write.vendors` | Vendors |
| `read.staff` / `write.staff` | Employees |
| `read.catalog` | Packages and add-ons |
| `read.equipment` | Equipment |
| `read.documents` / `write.documents` | Documents |
| `read.planning` / `write.planning` | Planner |
| `read.inbox` | Inbox |
| `read.reports` | Reports |
| `read.settings` | Settings reads, helpers, templates |
| `money` | Payments, schedules, balances |
| `money.payroll` | Payroll figures and wage rates |
| `delete` | Permanent deletes and client erasure |
| `comms.email` | Client or staff email |
| `comms.sms` | Client texts |
| `comms.contract` | Send a Booking Agreement / e-sign email |
| `helpers.run` | Run a booking helper |

A helper that emails also needs `comms.email`. If that email attaches a contract, it also needs `comms.contract`. A helper that texts needs `comms.sms`. The preview says which.

## Tools

`CONFIRM` means the first call only stores a receipt. A person approves it in XOS. `xos_confirm` does not run it.

Built in, any valid token:

- `xos_whoami` — what this token can do
- `xos_confirm` — read whether a person has approved a receipt. It does not approve and it does not run.

| Tool | Scopes | Confirm |
| --- | --- | --- |
| search | any token; results follow read scopes | |
| events_list | read.events | |
| events_get | read.events | |
| events_form_options | read.events | |
| events_create | write.events | |
| events_update | write.events | |
| events_set_status | write.events | yes |
| events_set_comms_paused | write.events | |
| events_archive | write.events | yes |
| events_unarchive | write.events | |
| events_delete | delete | yes |
| events_add_note | write.events | |
| events_delete_note | delete | yes |
| events_add_client | write.events, write.clients | |
| events_remove_client | write.events | yes |
| events_add_addon | write.events | |
| events_remove_addon | write.events | yes |
| events_update_financials | write.events, money | yes |
| events_assign_staff | write.events, write.staff | |
| events_remove_staff | write.events | yes |
| events_set_planning_template | write.planning | yes |
| planning_get | read.planning | |
| clients_list | read.clients | |
| clients_get | read.clients | |
| clients_create | write.clients | |
| clients_update | write.clients | |
| clients_anonymize | delete | yes |
| clients_invite | comms.email | yes |
| clients_reset_password | comms.email | yes |
| venues_list | read.venues | |
| venues_get | read.venues | |
| venues_create | write.venues | |
| venues_archive | write.venues | |
| vendors_list | read.vendors | |
| vendors_get | read.vendors | |
| vendors_create | write.vendors | |
| staff_list | read.staff | |
| staff_get | read.staff | |
| staff_create | write.staff | |
| staff_set_active | write.staff | |
| staff_update_wages | money.payroll | yes |
| staff_invite | comms.email | yes |
| packages_list | read.catalog | |
| equipment_list | read.equipment | |
| documents_list | read.documents | |
| documents_get | read.documents | |
| documents_generate | write.documents | |
| documents_send_for_signature | comms.contract | yes |
| documents_set_status | write.documents | yes |
| payments_list | money | |
| payments_add | money | yes |
| payments_update | money | yes |
| payments_confirm | money | yes |
| payments_remove | money | yes |
| payments_restore | money | yes |
| payments_save_schedule | money | yes |
| payments_add_schedule | money | yes |
| payments_proposal_link | read.events | |
| reports_outstanding | read.reports, money | |
| payroll_generate | money.payroll | yes |
| payroll_log_payment | money.payroll | yes |
| helpers_list | read.settings | |
| helpers_preview | helpers.run | |
| helpers_run | helpers.run, plus comms scopes the helper needs | yes |
| email_templates_list | read.settings | |
| comms_send_email_template | comms.email, and comms.contract when the template attaches a document | yes |
| comms_send_sms | comms.sms | yes |
| comms_drain_outbox | comms.email, comms.sms | yes |
| comms_run_scheduled | comms.email, comms.sms | yes |
| inbox_list | read.inbox | |
| inbox_get | read.inbox | |
| inbox_reply | read.inbox, plus comms.email or comms.sms for the channel | yes |
| settings_overview | read.settings | |

`documents_send_for_signature` calls `sendDocumentForSignature`, the same function as the document page's Send for signature button.

`helpers_run` calls `executeBookingHelper`: the database helper, then `processOutbox` and `processSmsOutbox`, so contract tags are filled before the message leaves.

`comms_send_email_template` queues the row the way a helper's send-email action does, then runs the same outbox.

## Not exposed

These stay off the connector on purpose.

- Signing a Booking Agreement, confirming a proposal, paying, and redeeming a join code. Those are the client's own steps.
- Passkeys, two-factor, password changes, and the forgot-password page. Agents are not staff.
- Auth email templates, and anything the iOS app uses to sign in.
- Inbound webhooks (Mailgun, PayPal, HighLevel, Fireflies) and OAuth callbacks (Spotify, HighLevel).
- Photo and file uploads. Those need a file from the browser.
- The permission grid. A bad edit can lock the office out.
- Dev-only routes.

There are no Supabase Edge Functions in this repo. The Netlify scheduled functions only call the same outbox and sync code the tools call.

## Mint, rotate, revoke

Master admin only. Settings → Agent Access (`/settings/mcp`).

1. After an explicit approval, apply `supabase/migrations/00217_mcp_service_access.sql` and `supabase/migrations/00218_mcp_approval_and_guards.sql` through the numbered migration history (the same process that records every other file in `supabase_migrations.schema_migrations`). Do not paste them as an untracked SQL editor script. The page shows "One-time setup needed" until those tables exist. This repo does not apply them.
2. Create a token. Name it, pick scopes, optional expiry. The raw token is shown once on that screen. It is not saved, not logged, and not put in the address bar. Copy it into the agent's secret store.
3. Rotate when you want a new secret. The new token works immediately. The old one keeps working for the overlap you set (default 24 hours, `0` turns it off now), then it stops. Both hashes stay in the table; the raw values do not.
4. Revoke kills a token immediately, including during an overlap.

The table stores `token_prefix` (the start of the token, so you can tell them apart) and `token_hash`. Row Level Security is on and the API roles have no grants. The settings page reads through the server after the master-admin check.

Audit rows are in `mcp_audit_log`. Confirmations are in `mcp_confirmations`. Idempotency keys are in `mcp_idempotency_keys`. Rate limits reuse `rate_limit_hits`.

## Deploy

Drew approves each of these. Nothing in this change deploys or applies the migration by itself.

1. Review the pull request.
2. Apply `00217` and `00218` through the migration history after you approve them. Approving a receipt in the app does nothing useful until `00218` is in that history.
3. Merge to `main`. Netlify builds from that push. Do not deploy with the local Netlify CLI.
4. Open Settings → Agent Access and mint the token.

The connector URL is the Netlify hostname, not `https://xos.xpressdjs.com`.

In Netlify: Domain management → the `*.netlify.app` address. The path is `/api/mcp`.

Example shape, with the real site name filled in:

`https://<your-site>.netlify.app/api/mcp`

If that hostname is ever turned off, add a DNS-only name (Cloudflare grey cloud, not proxied) such as `mcp.xpressdjs.com` pointing at Netlify, and use `https://mcp.xpressdjs.com/api/mcp`. Do not orange-cloud it. An orange-cloud name puts the bot check back in front.

## Register the connector

Use streamable HTTP (also called HTTP), not stdio.

- URL: `https://<your-site>.netlify.app/api/mcp`
- Header name: `Authorization`
- Header value: `Bearer <the token from Agent Access>`

The word `Bearer` and a space are required. Do not put the token in the URL.

Cursor custom MCP server, or any client that speaks remote MCP:

```json
{
  "mcpServers": {
    "xos": {
      "url": "https://<your-site>.netlify.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <paste the token here>"
      }
    }
  }
}
```

This server has not been registered against a live agent. Do not treat a URL in this document as a connected connector.

The deploy preview of `4d930541d82debe5d85ef3de498d48e611a63ab2` failed in about 23 seconds with no public error message, and the build-log API returned unauthorized. A local `next build` of that tree failed because `events/actions.ts` re-exported `HelperSmsOverride` and `HelperSmsPrompt` from a `"use server"` file. Turbopack treats those as server-action exports. The types now come from `src/lib/bookingHelperRun.ts`, and a later local production build completed. That local build is not a Netlify deploy, and this branch has not been deployed.

The transport follows the 2025-06-18 streamable HTTP rules that were checked in the spec: one POST endpoint, JSON responses, `GET` returns 405 because there is no SSE stream, missing `MCP-Protocol-Version` is accepted as the older 2025-03-26 client, and any other version is rejected. That is a spec reading, not a completed client handshake.

After a person connects it, `xos_whoami` should list only the granted scopes. A risky tool returns a receipt. A person approves that receipt in XOS. `xos_confirm` does not do that approval.

A dropped response can be retried with the same `Idempotency-Key`. Do not reuse a key for a different action.
