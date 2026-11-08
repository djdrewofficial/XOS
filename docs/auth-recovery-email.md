# Password reset email

Production main checked: `50375db65b62484aec1317c4c82f613e62fb7e4d`.

No live Auth setting, template, allow list, database row, or password was changed. No reset email was sent. A tapped link was not reproduced on a device.

## What the live template is

Inspected in the dashboard, not guessed from the screenshot wording alone:

- Subject: `Reset your password`
- Button href, exact: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`
- It is not `{{ .ConfirmationURL }}`
- The template does not contain `/auth/confirm`
- Site URL: `https://xos.xpressdjs.com`

The href is the caller's `redirectTo`, plus the token hash. Staff forgot-password in this repo passes `https://xos.xpressdjs.com/auth/set-password` (`passwordResetRedirect`). Client app PR 29 (`715820247b8e1257d527f2ecc318db5140412c68`) passes `https://xos.xpressdjs.com/auth/reset`. The same template then builds a different URL for each caller. Cosmetic replacement of the "XOS password" sentence can keep this href exactly.

This is one shared Supabase template. Do not paste the Xpress DJs file into it. That would change the staff email. The Xpress DJs file is only for a later split where XOS sends the client mail itself.

## Allow list already present

Recorded from the dashboard. Do not edit it until Drew says so.

- `https://xos.xpressdjs.com/auth/set-password`
- `https://xos.xpressdjs.com/**`
- `xpressclient://auth/set-password`
- `http://localhost:3000/auth/set-password`
- `http://127.0.0.1:3000/auth/set-password`
- `https://**--xos-xpressdjs.netlify.app/auth/set-password`
- `https://xos.xpressdjs.netlify.app/auth/set-password`
- `xpressclient://auth/confirm`
- `xpressclient://auth/reset`

`https://xos.xpressdjs.com/**` already matches `https://xos.xpressdjs.com/auth/reset` on that host. Adding the exact reset URL is optional and is not done here. Do not add `*` or another scheme.

## What this repo now serves

`/auth/reset` shows the same password form as `/auth/set-password`, including the staff MFA step. A normal signed-in visit still does not open the form. The page reads `token_hash`, `type=recovery`, a PKCE `code`, or a hash token, then removes them from the address bar. It does not log them.

`/auth/confirm` only forwards a recovery `token_hash` to `/auth/reset` on the same host. Signup and other types are not turned into a password reset. `next` and `redirect_to` are dropped.

Apple app links still include `/j/*`. They also include the exact paths `/auth/reset`, `/auth/confirm`, and `/auth/set-password`. The staff sign-in callback is not included, so that login stays on the website. There are no webcredentials. The team id still comes from `APPLE_TEAM_ID`. The couple app id in the client repo is `VH9Z63JB8L.com.xpressentertainment.client`.

Staff mail still uses `/auth/set-password`. Claiming that path means an installed couple app can open a staff reset link. If the link stays in the browser, the form still requires the staff MFA step. This site never redirects the browser to `xpressclient://`.

Staff Mailgun resets and `POST /api/mobile/forgot-password` are unchanged and still say XOS.

## Template files, not installed

- `docs/auth-email-templates/reset-password.staff-link-fix.html` — subject `Reset your password`. Href is the live `{{ .RedirectTo }}` pattern.
- `docs/auth-email-templates/reset-password.client.html` — subject `Reset your Xpress DJs password`. Same href. Do not install it in the shared template.
