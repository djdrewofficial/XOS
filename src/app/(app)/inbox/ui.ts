import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faCommentSms,
  faPhone,
  faEnvelope,
  faVoicemail,
  faCircleInfo,
} from "@fortawesome/free-solid-svg-icons";
import { faInstagram, faWhatsapp, faFacebookMessenger, faGoogle } from "@fortawesome/free-brands-svg-icons";

export function channelIcon(type: string | null): IconDefinition {
  switch (type) {
    case "TYPE_SMS":
      return faCommentSms;
    case "TYPE_CALL":
    case "TYPE_NO_SHOW":
      return faPhone;
    case "TYPE_EMAIL":
      return faEnvelope;
    case "TYPE_VOICEMAIL":
      return faVoicemail;
    case "TYPE_FACEBOOK":
      return faFacebookMessenger;
    case "TYPE_INSTAGRAM":
      return faInstagram;
    case "TYPE_WHATSAPP":
      return faWhatsapp;
    case "TYPE_GMB":
      return faGoogle;
    default:
      return faCircleInfo;
  }
}

/** Brand accent for channel icons (chips, tabs, list avatars). */
export function channelColor(type: string | null): string | null {
  switch (type) {
    case "TYPE_INSTAGRAM":
      return "#E1306C";
    case "TYPE_WHATSAPP":
      return "#25D366";
    case "TYPE_FACEBOOK":
      return "#0084FF";
    case "TYPE_GMB":
      return "#4285F4";
    default:
      return null;
  }
}

export function channelLabel(type: string | null): string {
  switch (type) {
    case "TYPE_SMS":
      return "Text";
    case "TYPE_CALL":
      return "Call";
    case "TYPE_EMAIL":
      return "Email";
    case "TYPE_VOICEMAIL":
      return "Voicemail";
    case "TYPE_FACEBOOK":
      return "Facebook";
    case "TYPE_INSTAGRAM":
      return "Instagram";
    case "TYPE_WHATSAPP":
      return "WhatsApp";
    case "TYPE_GMB":
      return "Google Business";
    default:
      return type ? type.replace(/^TYPE_/, "").replaceAll("_", " ").toLowerCase() : "activity";
  }
}

/** "2:41 PM" today, "Jun 10" this year, "6/10/25" otherwise — company timezone. */
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const tz = "America/New_York";
  const sameDay = d.toLocaleDateString("en-US", { timeZone: tz }) === now.toLocaleDateString("en-US", { timeZone: tz });
  if (sameDay) return d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { timeZone: tz, month: "numeric", day: "numeric", year: "2-digit" });
}

/** Full timestamp for message bubbles. */
export function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
