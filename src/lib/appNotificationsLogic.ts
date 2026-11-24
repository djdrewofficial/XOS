/* Pure helpers for couple-app notifications (no DB / server-only). */

import { CLIENT_APP_SCHEME } from "@/lib/clientApp";

export const APP_NOTIF_TABS = [
  "home",
  "planning",
  "timeline",
  "payments",
  "documents",
  "music",
  "guests",
  "settings",
] as const;
export type AppNotifTab = (typeof APP_NOTIF_TABS)[number];

export type AppNotifAudience = "hosts" | "hosts_and_guests" | "guests";
export type AppNotifTrigger = "schedule" | "status_change" | "helper";
export type AppNotifTapAction = "tab" | "screen" | "none";
export type AppNotifEmbedSource = "none" | "dj_booking_embed" | "custom_html";

export type AppScreenButton = {
  label: string;
  action: "tab" | "url" | "dismiss";
  tab?: string;
  url?: string;
};

export type PrimaryDjLite = {
  name: string;
  bookingUrl: string;
  bookingEmbedHtml: string;
};

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Calendar target day for a schedule template. */
export function appNotifTargetDate(opts: {
  anchorDate: string | null;
  days: number;
  direction: "before" | "after";
}): string | null {
  if (!opts.anchorDate) return null;
  const delta = opts.direction === "before" ? -opts.days : opts.days;
  return addDays(opts.anchorDate.slice(0, 10), delta);
}

export function deepLinkForMessage(logId: string): string {
  return `${CLIENT_APP_SCHEME}://message/${logId}`;
}

export function deepLinkForScreen(screenId: string): string {
  return `${CLIENT_APP_SCHEME}://screen/${screenId}`;
}

export function deepLinkForTab(tab: string): string {
  return `${CLIENT_APP_SCHEME}://tab/${tab}`;
}

/** Pure: should this event receive automated couple-app notifications? */
export function shouldSendAppNotifications(event: {
  archived_at?: string | null;
  demo_mode?: boolean | null;
  status_name?: string | null;
  is_lost_sale_group?: boolean | null;
  allow_demo_mode?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (event.archived_at) return { ok: false, reason: "archived" };
  const name = (event.status_name ?? "").toLowerCase();
  if (name === "cancelled" || name.includes("cancel")) return { ok: false, reason: "cancelled" };
  if (event.is_lost_sale_group) return { ok: false, reason: "lost_sale" };
  if (event.demo_mode && !event.allow_demo_mode) return { ok: false, reason: "demo_mode" };
  return { ok: true };
}

/** Apply DJ-only tags after SQL render_merge_tags (embed never goes through SQL). */
export function applyDjMergeTags(
  text: string,
  dj: PrimaryDjLite,
  opts: { allowEmbed?: boolean } = {},
): string {
  let out = text
    .replace(/&lt;dj_name&gt;/gi, "<dj_name>")
    .replace(/&lt;dj_booking_url&gt;/gi, "<dj_booking_url>")
    .replace(/&lt;dj_booking_embed&gt;/gi, "<dj_booking_embed>")
    .replace(/<dj_name>/gi, dj.name)
    .replace(/<dj_booking_url>/gi, dj.bookingUrl);
  if (opts.allowEmbed) {
    out = out.replace(/<dj_booking_embed>/gi, dj.bookingEmbedHtml);
  } else {
    out = out.replace(/<dj_booking_embed>/gi, "");
  }
  return out;
}

/** Extract https origins from staff-authored embed HTML for WebView allowlisting. */
export function originsFromHtml(html: string): string[] {
  const origins = new Set<string>();
  const re = /https?:\/\/[^\s"'<>]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      origins.add(new URL(m[0]).origin);
    } catch {
      /* ignore */
    }
  }
  return [...origins].slice(0, 20);
}

/** Sort event_staff rows the same way merge tags pick primary DJ. */
export function pickPrimaryDjRow<T extends { role: string; stageName: string | null; firstName: string | null }>(
  rows: T[],
): T | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const aDj = /dj/i.test(a.role) ? 1 : 0;
    const bDj = /dj/i.test(b.role) ? 1 : 0;
    if (bDj !== aDj) return bDj - aDj;
    const an = (a.stageName || a.firstName || "").toLowerCase();
    const bn = (b.stageName || b.firstName || "").toLowerCase();
    return an.localeCompare(bn);
  });
  return sorted[0] ?? null;
}

export function dedupeKeyFor(templateId: string, eventId: string, triggerKey: string, authUserId: string): string {
  return `${templateId}:${eventId}:${triggerKey}:${authUserId}`;
}
