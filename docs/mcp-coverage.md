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
| Package weekday prices, helper button styling, document-template block editor, photobooth, briefings, and assistant articles | Not tools yet. They are missing editor functionality, not auth exclusions. |
