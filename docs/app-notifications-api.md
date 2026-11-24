# Couple-app notifications API (xpress-client)

Contract for the follow-up Expo app PR. Auth: `Authorization: Bearer <supabase_access_token>` on every route. Routes are middleware-exempt under `/api/mobile/`.

Deep-link scheme: `xpressclient` (see `CLIENT_APP_SCHEME`).

| Push / message target | Example |
| --- | --- |
| Message | `xpressclient://message/<log_id>` |
| Custom screen | `xpressclient://screen/<screen_id>` |
| App tab | `xpressclient://tab/<tab>` (`home`, `planning`, `timeline`, `payments`, `documents`, `music`, `guests`, `settings`) |

## Register push token

`POST /api/mobile/app-notifications/register-push`

```json
{ "expoPushToken": "ExponentPushToken[…]", "platform": "ios", "deviceName": "optional" }
```

→ `{ "ok": true }`

Stores in `app_device_tokens` (separate from staff `device_tokens`).

## List pending messages + popups

`GET /api/mobile/app-notifications/messages?eventId=<uuid>`

Caller must be host, guest, or staff on the event.

```json
{
  "messages": [
    {
      "id": "…",
      "title": "…",
      "body": "…",
      "deep_link": "xpressclient://…",
      "tap_action": "tab|screen|none",
      "tap_tab": "planning|null",
      "screen_id": "uuid|null",
      "show_as_popup": true,
      "status": "queued|sent|opened",
      "queued_at": "…",
      "sent_at": "…"
    }
  ],
  "popups": [
    { "id": "…", "title": "…", "body": "…", "deep_link": "…", "screen_id": "…" }
  ]
}
```

`popups` are undismissed / unopened rows with `show_as_popup`. Show as a modal on next app open even without push permission.

## Fetch custom screen

`GET /api/mobile/app-notifications/screens/<screenId>?eventId=<uuid>`

```json
{
  "screen": {
    "id": "…",
    "name": "…",
    "heading": "…",
    "body_html": "…",
    "buttons": [{ "label": "…", "action": "tab|url|dismiss", "tab": "…", "url": "…" }],
    "embed_html": "<iframe…>|null",
    "dj": { "name": "…", "booking_url": "…" },
    "render": {
      "mode": "webview_sandbox",
      "allowed_origins": ["https://…"],
      "open_links": "external"
    }
  },
  "security": {
    "embed_is_staff_authored": true,
    "required_webview": "sandboxed",
    "open_links": "external_or_in_app_browser",
    "note": "…"
  }
}
```

**Rendering:** load `embed_html` only in a sandboxed WebView. Restrict navigation to `render.allowed_origins`. Open `<a>` / unexpected navigations in an external or in-app browser. Never evaluate staff HTML in the React Native JS thread.

## Mark opened / dismissed

`POST /api/mobile/app-notifications/messages/<id>`

```json
{ "action": "opened" }
```
or `{ "action": "dismissed" }` → `{ "ok": true }`

## Push payload

Expo message `data`:

```json
{ "deepLink": "xpressclient://message/<id>", "messageId": "<id>" }
```

## Preferences

Optional table `app_notification_prefs` (`push_enabled`, `popup_enabled`). Missing row = both enabled.

## Migration

`00241_app_push_notifications.sql` (PR #95 claims `00240`).
