import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyDjMergeTags,
  appNotifTargetDate,
  deepLinkForMessage,
  deepLinkForScreen,
  deepLinkForTab,
  dedupeKeyFor,
  originsFromHtml,
  pickPrimaryDjRow,
  shouldSendAppNotifications,
} from "@/lib/appNotificationsLogic";
import { CLIENT_APP_SCHEME } from "@/lib/clientApp";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("appNotificationsLogic", () => {
  it("computes schedule target dates before and after the anchor", () => {
    assert.equal(appNotifTargetDate({ anchorDate: "2026-06-20", days: 7, direction: "before" }), "2026-06-13");
    assert.equal(appNotifTargetDate({ anchorDate: "2026-06-20", days: 3, direction: "after" }), "2026-06-23");
    assert.equal(appNotifTargetDate({ anchorDate: null, days: 1, direction: "before" }), null);
  });

  it("skips archived, cancelled, lost-sale, and demo (unless allowed)", () => {
    assert.equal(shouldSendAppNotifications({ archived_at: "2026-01-01" }).ok, false);
    assert.equal(shouldSendAppNotifications({ status_name: "Cancelled" }).ok, false);
    assert.equal(shouldSendAppNotifications({ is_lost_sale_group: true }).ok, false);
    assert.equal(shouldSendAppNotifications({ demo_mode: true }).ok, false);
    assert.equal(shouldSendAppNotifications({ demo_mode: true, allow_demo_mode: true }).ok, true);
    assert.equal(shouldSendAppNotifications({ status_name: "Booked" }).ok, true);
  });

  it("builds deep links with the couple-app scheme", () => {
    assert.equal(deepLinkForMessage("abc"), `${CLIENT_APP_SCHEME}://message/abc`);
    assert.equal(deepLinkForScreen("scr"), `${CLIENT_APP_SCHEME}://screen/scr`);
    assert.equal(deepLinkForTab("planning"), `${CLIENT_APP_SCHEME}://tab/planning`);
  });

  it("resolves DJ merge tags and strips embed unless allowed", () => {
    const dj = { name: "DJ Drew", bookingUrl: "https://book.example/drew", bookingEmbedHtml: "<iframe src='https://hl.example/w'></iframe>" };
    assert.equal(applyDjMergeTags("Hi <dj_name> — <dj_booking_url>", dj), "Hi DJ Drew — https://book.example/drew");
    assert.equal(applyDjMergeTags("x <dj_booking_embed> y", dj, { allowEmbed: false }), "x  y");
    assert.match(applyDjMergeTags("x <dj_booking_embed> y", dj, { allowEmbed: true }), /iframe/);
    assert.equal(applyDjMergeTags("x &lt;dj_name&gt; y", dj), "x DJ Drew y");
  });

  it("picks primary DJ with DJ-role first", () => {
    const pick = pickPrimaryDjRow([
      { role: "Assistant", stageName: "Alex", firstName: "Alex" },
      { role: "DJ", stageName: "Drew", firstName: "Drew" },
      { role: "DJ", stageName: "Zoe", firstName: "Zoe" },
    ]);
    assert.equal(pick?.stageName, "Drew");
  });

  it("extracts origins from embed HTML for WebView allowlisting", () => {
    const html = `<iframe src="https://api.leadconnectorhq.com/widget/book"></iframe><script src="https://cdn.example.com/x.js"></script>`;
    const origins = originsFromHtml(html);
    assert.ok(origins.includes("https://api.leadconnectorhq.com"));
    assert.ok(origins.includes("https://cdn.example.com"));
  });

  it("builds stable dedupe keys", () => {
    assert.equal(dedupeKeyFor("t1", "e1", "2026-06-13", "u1"), "t1:e1:2026-06-13:u1");
  });
});

describe("app push notifications migration + wiring", () => {
  it("claims migration 00241 (after PR 95's 00240)", () => {
    const sql = read("supabase/migrations/00241_app_push_notifications.sql");
    assert.match(sql, /create table if not exists app_notification_templates/);
    assert.match(sql, /create table if not exists app_notification_screens/);
    assert.match(sql, /create table if not exists app_notification_log/);
    assert.match(sql, /create table if not exists app_device_tokens/);
    assert.match(sql, /booking_embed_html/);
    assert.match(sql, /dj_booking_embed/);
    assert.doesNotMatch(sql, /replace\(out_text, '<dj_booking_embed>'/);
  });

  it("drains couple-app notifications from the outbox cron", () => {
    const cron = read("src/app/api/cron/send-outbox/route.ts");
    assert.match(cron, /runScheduledAppNotifications/);
    assert.match(cron, /processAppNotificationOutbox/);
  });

  it("exposes couple-app API routes under /api/mobile/app-notifications", () => {
    assert.ok(read("src/app/api/mobile/app-notifications/register-push/route.ts").includes("app_device_tokens"));
    assert.ok(read("src/app/api/mobile/app-notifications/messages/route.ts").includes("listPendingAppMessages"));
    assert.ok(read("src/app/api/mobile/app-notifications/screens/[screenId]/route.ts").includes("sandboxed"));
    assert.ok(read("src/lib/appNotifications.ts").includes("webview_sandbox"));
    assert.ok(read("src/app/api/mobile/app-notifications/messages/[id]/route.ts").includes("markAppNotification"));
  });

  it("documents MCP list/preview/send tools", () => {
    const office = read("src/lib/mcp/tools/office.ts");
    assert.match(office, /name: "app_notifications_list"/);
    assert.match(office, /name: "app_notifications_preview"/);
    assert.match(office, /name: "app_notifications_send"/);
    assert.match(office, /confirm: true/);
    const docs = read("docs/mcp.md");
    assert.match(docs, /app_notifications_list/);
    assert.match(docs, /app_notifications_send/);
  });
});
