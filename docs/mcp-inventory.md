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

## Closed in the following batch

| Operation | Tool |
| --- | --- |
| Employee name and contact, without tier, login, or send-as-self | `employees_profile` |
| Employee photo, PNG JPEG or WebP, 192 KB | `employees_photo` |
| Vendor category | `vendors_category` |
| SMS STOP and marketing consent | `clients_sms_consent` |
| Delete a reminder rule | `payment_reminders_delete` |
| Article active flag and delete | `assistant_article_status` |
| Restore hidden client content | `content_restore` |
| Remove a non-holder app member | `app_members_remove` |
| Resend, reset link, or email join code, without returning the secret | `app_invites_send` |
| Global signing field list | `signing_requirements` |
| Staff feature, payroll display, notification, and sort settings | `staff_settings_save` |
| Payment methods, reasons, and fee percent | `payment_settings_save` |
| Social links and send window | `company_mail_settings` |
| Venue mileage | `venues_mileage` |
| Package and add-on create, price, delete | `catalog_items` |
| Equipment item, system, assignment, storage location | `equipment_catalog` |
| Custom date field definition | `custom_date_fields` |
| Mark a conversation read | `inbox_mark_read` |
| Attach or unlink a Fireflies meeting | `fireflies_link` |
| Revert an unsent scheduled override | `scheduled_comms_revert` |
| Helper create, copy, move, delete | `helpers_lifecycle` |
| Notification audience | `notification_audiences` |
| Expense category list | `expense_lists` |
| Client role and event type labels | `directory_labels` |
| Payroll frequency and manual payables | `payroll_settings_save` |
| Email template create, copy, hide | `email_template_lifecycle` |
| Planner template create, default, delete | `planner_template_admin` |
| Backdrop active flag, order, delete | `photobooth_admin` |

Inquiry sources, event statuses, journey create and rename, dashboard layout, and equipment damage were already tools: `sources_save`, `statuses_save`, `statuses_delete`, `journeys_save`, `dashboard_layout_save`, `equipment_report_damage`, `equipment_resolve_damage`.

Permission tier, login id, send-as-self, and the permission grid stay excluded.

## Not a tool, and why

These are the remaining distinct operations. They are not identity exclusions. They are blocked because launching them would send or import without a frozen row set.

| Operation | Decision |
| --- | --- |
| Run the payment reminder pass | `run_payment_reminders` inserts `queued` mail. The cron would send it before a person could approve the bodies. It needs the same held-at-birth path as onboarding. |
| Run scheduled mail for every event, send a test email | Same queued-mail problem. A test send also has no frozen body yet. |
| Apply mileage to existing events, run daily status changes | These rewrite many rows. The agent does not yet freeze the exact expense or status rows that would change. |
| Sync Fireflies, sync the inbox | Both pull a live vendor account. There is no approved set of meetings or conversations to limit the pull. |
| Backdrop image bytes and equipment photos | The bytes follow `events_file_upload` once those buckets accept the same 192 KB check. The metadata tools do not fetch a URL. |
| Per-type signing layout and notification template text | The global signing list and the audience row are tools. The per-type proposal layout and the staff title template text are still the settings forms. |
| Add-on planning section defaults | Equipment defaults are `addons_equipment_defaults`. The section checklist is not a tool yet. |
