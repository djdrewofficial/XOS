# MCP coverage

Applying migrations and registering a connector are approval-gated rollout steps. They are not done in this change. See the order in `docs/mcp.md`.

`booking_helpers` and `email_templates` have no `updated_at` column in migrations `00001` through `00218`. Effect snapshots hash the helper actions and the template body instead of reading that column.

`src/lib/mcp/tools/office.ts` and `src/lib/mcp/tools/coverage.ts` cover the office screens that were still missing: the new-event wizard, package and add-on edits with versions and date prices, template and helper edits, scheduled-comm skip, undo, mark-sent, and override, expenses, trips, equipment damage and photos, Fireflies review, vendor-suggestion review, venue merge, status, source, and custom-field editors, timesheet approval, planner templates, notification audience channels, journeys, the dashboard layout, and venue, vendor, staff, and equipment edits.

Payments stay attached to their event in `00218`: the foreign key is `ON DELETE RESTRICT`. That file is not applied. The isolated test creates a payment with `ON DELETE SET NULL`, applies `00218`, and checks that deleting the event is refused and the payment still points at the event.

Staff client removal and the agent tool both call `mcp_remove_event_client`. Until `00218` is applied, both fail closed and delete nothing.

Security exclusions, which stay off the connector:

- Client signing, proposal confirm, and the client portal acting as the couple
- Passkeys, two-factor, password changes, and auth email templates
- Minting agent tokens from an agent token
- The permission grid
- Spotify export and playlist import, which use the signed-in staff member's own Spotify login
- HighLevel OAuth connect, which is a browser redirect
- Employee self check-in and self-filed timesheet requests, which are bound to the signed-in employee

Signing URLs and other client secret links are stored for the admin approval screen and removed from agent responses and the audit log.

## Parity

| Area | State |
| --- | --- |
| Event wizard, including numeric-string wages, new venue, new source, and price override scopes | Tool `events_create_onboarding`. The frozen effect lists the event-created helpers. |
| Helper visibility, required fields, and automatic triggers | `helpers_update` with `visibility_json`. Omitting that object does not change visibility. |
| Template schedule and visibility columns | `email_templates_update` with `schedule_json`. Omitting it does not change the schedule. |
| Planner template questions and event planner sections/questions | `planner_questions` and `planner_event_edit`. |
| Venue and vendor contact rows | `venues_contact` and `vendors_contact`, deleted only when the row belongs to that parent. |
| Per-event scheduled send that is due today | `comms_run_scheduled`. It sends the rendered messages it listed. It does not call the global cron. |
| Spotify playlist sync and export | `spotify_sync_event` and `spotify_export`, only when a Spotify account is already connected. |
| Spotify or HighLevel OAuth login, passkeys, the permission grid, client signing, and employee self check-in | Excluded. They are a browser login or a specific signed-in person, not an office record. |
| Package weekday prices | `packages_weekday_prices` replaces the Sunday–Saturday map. |
| Helper button styling | `helpers_button`. |
| Document template blocks | `document_template_blocks`. |
| Photo booth backdrop name and category | `photobooth_backdrops`. The image file upload stays a staff browser action. |
| Staff briefing preference | `briefing_prefs`. Sending the briefing now is not this tool. |
| Assistant articles | `assistant_articles`. Running a task that emails people is not this tool. |

Agreement and event-file bytes go through `enrichOutbound`, the same function the outbox calls. A test runs that function with a fake database and asserts the PDF buffer and the event-file buffer that delivery would receive. Approval stores the document HTML hash and the event-file hashes. If either changes, the outbox puts the row back and does not send. Chrome's PDF bytes are not hashed across preview and send, because a second render is not byte-identical. A Booking Agreement that has no document row yet is refused by the agent send (`pdf_deferred`) so an unbound file is not created during the send. The set-password link inside an invite is still minted at send time. Onboarding approval stores the helper action graph, the template body, and the full webhook URL. It does not store the merge-rendered recipient email, because that render needs the event row.

These office actions are still not tools and are not auth exclusions. They are named so they are not dropped quietly: event file upload and labels, equipment packed/notes, staff time off, package and addon category editors, addon equipment defaults, venue rooms and categories, payment reminder rules, merge tags, expense mileage settings, daily status actions, email signature and blackout dates, app-access invites, and content moderation. File upload from a browser stays a staff action. OAuth login, passkeys, the permission grid, client signing, and employee self check-in stay excluded.
