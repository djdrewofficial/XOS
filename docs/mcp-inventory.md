# Distinct office operations

Batch commit: `570978f9c9781815fbd99ed2379e0d03197bf696`. The pull request head may be this commit or the inventory stamp on top of it.

This inventory counts a business operation once. A second export that calls the same operation, a read-only loader, or a form wrapper is collapsed into that operation. It is not a separate missing editor.

Identity exclusions are actions whose actor is the client, the guest, the signed-in person changing their own login, or an inbound provider. Office edits that happen to live near those files are not exclusions.

## Collapsed, not separate operations

| Exports | Why they are one operation |
| --- | --- |
| `uploadEventFile` and `uploadEventFileForm` | The form wrapper calls the upload. Tool: `events_file_upload`. |
| `createClientAndAttach` | Create the client (`clients_create`) and attach them (`events_add_client`). |
| `loadNewEventFormData`, `getHelperSmsPrompts`, document template `GET`, reports `GET`, `loadThread`, `loadMoreConversations`, `listInboxClients` | Reads. The office reads are `events_form_options`, `helpers_preview`, `documents_get`, `reports_outstanding`, `inbox_get`, and `inbox_list`. |
| `deleteTemplateAndExit` | Same delete as `deleteTemplate`, then a redirect. |
| `addItemToSystemForm` | Same system membership as `setItemSystem`. |
| Portal `removeEventVendor` | Not the office tool. The couple removes their own vendor. The office tool is `events_remove_vendor` on `src/app/(app)/events/actions.ts`. |
| `updateEventDetails`, `updateEventVenue`, `updateEventLinks`, `updateBookingInfo`, `updateBookingDates`, `updateBillingTerms`, `acknowledgeScheduleTotal`, `updateEventPackageDescription` | One event-record operation. Tool: `events_record`. |
| Logistics, contract, and client notes plus `updateEventNote` | Tool: `events_notes`. |
| `markStaff`, `updateStaffDetails`, `toggleStaffPortal` | Tool: `events_staff_log`. A wage requires `money.payroll`. |
| `markEquipment` | Tool: `events_equipment_mark`. |
| `updateEventAddon` | Tool: `events_addon_wording`. A price requires `money`. |
| Document archive, copy, visibility, unsigned delete, unsigned block edit | Tool: `documents_manage`. Delete also requires `delete`. |

## Identity exclusions that were checked

These stay excluded because the actor is not the office token:

- Client portal and couple-app writes, including the couple's own vendor removal, songs, photos, and guest invites.
- Client signing and proposal confirmation.
- Passkeys, password reset, the signed-in person's own profile, and their own second factor.
- Employee self check-in and the employee's own timesheet request. Office approval of that request is `timesheet_requests`.
- OAuth login and provider callbacks for Spotify, HighLevel, and comms. Sync and export of an already stored connection stay tools.
- Inbound webhooks, public unsubscribe, client pay and PayPal routes, and the auth SMS hook `src/app/api/auth/hooks/send-sms/route.ts`.
- `saveRolePermissions`, `saveUserPermissions`, and staff `savePermissions` / `saveAccess`. Those change who is allowed to act. They are the permission grid, not an office record.

`saveFeatures`, `savePayroll`, and `saveNotifications` in staff settings are office configuration. They are outstanding, not exclusions.

## Covered in this batch

| Operation | Tool | Sources |
| --- | --- | --- |
| Event details, venue, links, booking, dates, billing, schedule acknowledgement, package wording | `events_record` | `src/app/(app)/events/actions.ts` |
| Event and client notes | `events_notes` | same file |
| Staff stamp, assignment, portal flag | `events_staff_log` | same file |
| Equipment check-out stamp | `events_equipment_mark` | same file |
| Add-on quantity, price, wording | `events_addon_wording` | same file |
| Document template archive or copy; unsigned document visibility, blocks, delete | `documents_manage` | `src/app/(app)/documents/actions.ts` |
| Held staff bell, push, and webhook rows included in the second approval | `events_release_held_sends` | `src/lib/automations.ts`, `src/lib/notify.ts` |
| Job launch sends only the approved rendered bodies | `jobs_launch` | `src/lib/jobApproval.ts` |

A status change made through `events_record` holds the resulting helper mail, staff notification, and webhook the same way onboarding does. `mcp_claim_held` moves the exact approved ids from `held` to `sending` or moves none of them. The cron selects `queued` only.

## Outstanding distinct operations

These are still office work. They are not exclusions.

1. Employee profile: general, contact, and photo.
2. App access: resend invite, remove member, reset join link, and email the join code. Each send needs its own rendered snapshot.
3. Fireflies: attach, unlink, and sync.
4. Revert a scheduled-message override.
5. Restore hidden client content.
6. Vendor categories.
7. Client SMS opt-out and consent.
8. Payroll settings, manual payable, and remove payable.
9. Inquiry sources, where `sources_save` does not already cover the field.
10. Helper create, duplicate, delete, move, and active toggle.
11. Signing requirements.
12. Journey types.
13. Article active flag and delete.
14. Delete a reminder rule, and run the reminder pass.
15. Photo-booth image, active flag, delete, and order.
16. Staff settings for features, payroll defaults, notification defaults, sort, and the employee row. Not the permission grid.
17. Client roles and event types.
18. Remaining company general settings.
19. Notification audiences and their templates.
20. Event status create, edit, and delete, where `statuses_save` does not already cover them.
21. Payment method and reason settings.
22. Email template create, duplicate, and delete; company mail settings, social links, send window, and a test send.
23. Expense option lists, per-venue mileage, and apply mileage to existing events.
24. Planner template create, default, duplicate, delete, and option-image upload. Questions and sections already have tools.
25. Inbox sync and mark-read. Reply and start are already tools.
26. Package and add-on create, delete, and their default equipment or sections.
27. Equipment catalog create, edit, storage locations, and photos. Damage report and resolve already have tools.
28. A custom date-field definition (`addCustomDateField`).

The next batch is employee profile, vendor categories, SMS consent, reminder delete, article active/delete, and restore-hidden content.
