# MCP coverage

The connector is not release-ready until migration `00218` is applied through the numbered history and a live handshake has been checked against a deploy preview.

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
