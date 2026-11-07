# INTERNAL — app policy release notes

These notes are for Drew, counsel, and the app. They are not customer policy. Publishing the three routes does not certify privacy, deletion, or App Store compliance, and it does not turn off staff AI.

## Canonical URLs for the client app

Use these. Do not keep the welcome sheet on `https://xpressdjs.com/privacy` or `https://xpressdjs.com/terms`.

- English privacy: `https://xos.xpressdjs.com/app-privacy`
- Spanish privacy: `https://xos.xpressdjs.com/app-privacy?lang=es`
- English terms: `https://xos.xpressdjs.com/app-terms`
- Spanish terms: `https://xos.xpressdjs.com/app-terms?lang=es`
- English deletion: `https://xos.xpressdjs.com/app-data-deletion`
- Spanish deletion: `https://xos.xpressdjs.com/app-data-deletion?lang=es`

The website booking policy stays at `/privacy`. The website terms stay at `/terms`. Each of those pages now links to the app documents. They were not rewritten.

Language links are real anchors, so they work without JavaScript. The active language is `aria-current="true"`. The active document is `aria-current="page"`. The page content sits in `<main lang="en">` or `<main lang="es">`.

## What the public pages include

`src/lib/appPolicies.ts` is the customer text from the approved pack:

- Privacy sections 1–15, English and Spanish, including the staff OpenAI disclosure. Acceptance of the policy is not permission for that processing. The disclosure does not say client recommendations have stopped on every installed build or on the live server.
- Terms sections 1–10, English and Spanish. Accepting the terms is not permission for third-party AI. The text still says a separate authorization is only proposed.
- Deletion: removing the app login, account row, event app memberships, and device tokens. Planning details, the guest record, the contract, and payment records stay with the booking. An Apple revoke is attempted and can fail. No retention period is stated.

No effective date is printed. Section 14 and terms section 10 still say a revision or effective date is added when a change is approved and published.

## What was left off the public pages

Review labels such as “Draft for review. Not yet effective.” are not shown to customers. The deletion page states what the app login deletion removes and what stays with the booking.

The in-app confirmation buttons, the welcome and upload notices, the staff AI opt-in, and the App Store worksheet are only in `approved-policy-pack.md`. Do not build the AI choices, a consent checkbox, or a success message from this pull request. Those controls are not implemented.

These two sentences stay internal because they are instructions to us, not a customer promise. The public Apple section already says the revocation attempt can fail or be skipped:

- Do not promise that Apple authorization is always revoked successfully. Revocation and failure handling need to be tested and repaired where needed.
- No debe prometerse que la autorización de Apple siempre se revoca correctamente. Deben probarse y corregirse la revocación y la gestión de fallos cuando sea necesario.

There is no public retention period and no anonymization job. Drew limited deletion to the app account only.

## Still unresolved before anyone treats this as a live legal release

- Consent. There is no working per-person opt-in, withdrawal, or server check before staff OpenAI calls, morning briefings, or pasted assistant content. Policy text is not permission. A host’s yes would not cover another person. Staff AI was not disabled.
- Deletion. In-app deletion still leaves CRM and guest records, planning content, contracts, payments, public cover URLs, planner files, and email logs. That is broader than a demonstrated legal exception. Email cleanup is not a substitute for the in-app associated-data deletion Apple expects. No retention period, in days or years, is configured or promised.
- Access. Host, guest, and staff boundaries, including a missing `accounts` row, still need a fresh test before any confidentiality claim.
- Apple revocation. Login deletion does not prove the Apple token was revoked.
- Old clients. xpress-client main `ad063558` has no passkeys and no For You. The handoff says TestFlight 18 still has For You. `POST /api/music/recommend` is removed in this branch by the merge of main (`98a98c2`, PR 44). It is not deployed until this branch reaches production, so an old installed app can still call it on the live site until then.
- Backups and vendors. Live backup and PITR lengths, Mailgun and Supabase log retention, the Auth email sender, OpenAI training terms, and hosting regions were not re-verified.
- Acceptance recording. Welcome acceptance is not stored on the server. This pull request does not add a checkbox or a consent record.
- Store listing. App Store privacy answers, age rating, support URL, and a custom-EULA versus standard-EULA choice are not submitted here. Spanish is the approved working translation, not a certified legal translation.
- Publication. Merging and deploying these pages makes the URLs reachable. It does not, by itself, fix privacy or deletion compliance.

No database migration is in this change. No auth, environment, or vendor setting was changed.
