# Password reset email: what sends it, and what not to change yet

Production main checked: `50375db65b62484aec1317c4c82f613e62fb7e4d`.

Drew's screenshot is not an email this repository sends.

The Mailgun reset in `src/lib/accounts.ts` (`resetHtml`) says "Password reset", "Click below to choose a new one", and the button "Reset My Password". The screenshot says "Reset your password", "Follow the link below to choose a new one", and the anchor "Reset password". That second wording is the Supabase password-reset example, with "XOS" added. It is not in this repo. Supabase Auth has one Reset password template per project. Staff "Forgot password" (`deliverPasswordReset` → `resetPasswordForEmail`) and a client app that calls Supabase directly both receive that same template. Custom SMTP can still show `Xpress Entertainment <xos@xpressdjs.com>`.

Do not paste an "Xpress DJs" template into that shared slot. It would replace the staff XOS wording. Do not create a second Supabase project from this change.

## Why the link does nothing

`/auth/set-password` is public and accepts `token_hash` plus `type=recovery` on any device. There was no `/auth/confirm` route. Supabase's current password guide tells the template to link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. That URL 404s here, so the button does nothing useful.

The older `{{ .ConfirmationURL }}` link verifies on `*.supabase.co` and then redirects. If `redirect_to` is not on the allow list, Supabase sends the person to the Site URL. The site home does not open the password form. A PKCE `code` also works only in the browser that requested the email.

This repo now adds `/auth/confirm`. It forwards only `token_hash` and `type=recovery` to `/auth/set-password` on the same host. `next`, `redirect_to`, and every other parameter are dropped. The route does not verify the token, log the query, or choose a host from the query string. `/auth/set-password` still performs the one-time `verifyOtp`. Staff MFA on that page is unchanged. AASA still lists only `/j/*`, so the link opens in the browser when the app is not installed, and it does not depend on the app being installed.

## Dashboard steps, after approval

Do not change the live template or allow list until that approval. Inspect first:

1. Authentication → Emails → Reset password. Record the subject and whether the anchor is `{{ .ConfirmationURL }}`, `{{ .TokenHash }}`, or `/auth/confirm`.
2. Authentication → URL Configuration. Record Site URL and the Redirect URLs list. Do not add `*` or a custom scheme.

Allow list to add, exact strings, no wildcards:

- `https://xos.xpressdjs.com/auth/set-password`
- `https://xos.xpressdjs.com/auth/confirm`

Site URL should be `https://xos.xpressdjs.com`.

Two template files are in `docs/auth-email-templates/`. Neither is installed.

- `reset-password.staff-link-fix.html` keeps the XOS sentence and points the button at `/auth/confirm`. Subject: `Reset your password`. This is the shared-slot candidate if the goal is to fix the dead link without renaming staff mail.
- `reset-password.client.html` says Xpress DJs. Subject: `Reset your Xpress DJs password`. Do not put it in the shared slot. Use it only if client resets are later sent by XOS (Mailgun) instead of the shared Auth template. The app's 6-digit code endpoint, `POST /api/mobile/forgot-password`, is a different email and is unchanged.

Staff admin reset (`sendPasswordReset` in `accounts.ts`) and the client code email stay on Mailgun and still say XOS.
