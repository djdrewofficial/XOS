# Mobile password reset bridge

Not applied to the live Supabase project. Do not paste the template until this page is on production.

## What was verified

Go's `html/template` renders the current href `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` with `RedirectTo` set to `xpressclient://auth/reset` as `href="#ZgotmplZ?token_hash=...&type=recovery"`. An `https` staff redirect is left intact. This matches the Supabase note on `#ZgotmplZ` for a non-http scheme: https://supabase.com/kb/troubleshooting/pkce-flow-errors-cannot-parse-response-or-zgotmplz-in-magic-link-emails-433665

The 4:43 PM message's exact href was not available, so that Safari JSON 404 is not attributed to this output.

TestFlight 21 (`xpress-client` `5e4a3b1f`) requests `xpressclient://auth/reset`. Its handler accepts `token_hash` and does not adopt an access-token fragment. This page does not call `verifyOtp`.

## Deployment order

1. Review and merge this pull request.
2. Let the production deploy finish so `https://xos.xpressdjs.com/auth/reset` answers.
3. Only then paste `docs/auth-email-templates/reset-password.branded.html` into the Supabase Reset password template. Subject stays `Reset your password`.
4. Leave the redirect allow list and Apple app links unchanged. `https://xos.xpressdjs.com/**` already covers the bridge. `xpressclient://auth/reset` is already allowed. Apple links stay `/j/*` only.

Changing the template first would send people to a page that is not deployed yet.

The template maps that exact app redirect to `https://xos.xpressdjs.com/auth/reset?token_hash={{ .TokenHash }}&type=recovery`. Every other redirect, including staff `https://xos.xpressdjs.com/auth/set-password`, keeps the current `RedirectTo` plus the token query. It does not use `ConfirmationURL`.

## Device check after both steps

From TestFlight 21, request a password reset. The button should open Safari on the bridge, not a JSON 404. Tap Open Xpress DJs. The app should show its reset screen. A staff reset should still land on `/auth/set-password` and ask for the staff MFA step when that account requires one.
