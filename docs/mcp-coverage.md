# MCP coverage

This is not a complete map of every XOS function, and the connector is not release-ready.

The office tools in `src/lib/mcp/tools/office.ts` cover event, client, venue, vendor, staff, document, payment, payroll, inbox, and helper reads and a subset of writes. Sensitive writes wait for a person in Settings → Agent Access.

Still not tools, and not claimed as covered:

- The full new-event wizard (`createEventOnboarding`)
- Package and add-on editors, versions, and date prices
- Email template and booking-helper editors
- Scheduled-comm skip, override, and mark-sent
- Expenses, trips, and equipment damage or photos
- Fireflies review, Spotify export, vendor-suggestion review, and venue merge
- Status, source, and custom-field editors beyond what a single tool already does
- Most settings screens (permissions, dashboard layout, notifications, journeys, planner templates)

Security exclusions, which should stay off the connector:

- Client signing, proposal confirm, and the client portal acting as the couple
- Passkeys, two-factor, password changes, and auth email templates
- Minting agent tokens from an agent token
- The permission grid
- Spotify export, which uses the signed-in staff member's own Spotify login
- HighLevel OAuth connect, which is a browser redirect

`docs/mcp.md` lists the tools that exist today.
