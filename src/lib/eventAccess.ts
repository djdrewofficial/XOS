/* Couple-app invites and join codes.
   Access stays on the existing model: a couple member is a client linked to
   the event (host). An event guest is not. Decisions in this file are pure
   so the routes, the sign-in claim, and the tests share one set of rules.
   The database claim trigger (migration 00212) follows planInviteClaim. */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, type CipherKey } from "node:crypto";

/* US phone helpers, same rules as src/lib/phone.ts. Kept local so this module
   stays free of extensioned imports (the test runner and tsc disagree on those). */
function toE164(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.startsWith("+")) return `+${trimmed.replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function formatPhone(raw: string | null): string | null {
  if (!raw) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

export const JOIN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 8;
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const JOIN_CODE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const JOIN_LINK_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const JOIN_TOKEN_LENGTH = 22;
export const JOIN_ATTEMPT_LIMIT = 8;
export const JOIN_IP_ATTEMPT_LIMIT = 30;
export const JOIN_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_PARTNER_ROLE = "Partner";

const AMBIGUOUS = new Set(["0", "O", "1", "I", "L"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AccountKind = "staff" | "client" | "event_guest" | null;
export type CoupleRole = "staff" | "host" | "guest" | null;
export type LinkRole = "host" | "guest";
export type InviteLang = "en" | "es" | "both";

export type OpenInvite = {
  id: string;
  eventId: string;
  clientId: string | null;
  createdClient: boolean;
  role: string;
  email: string | null;
  phoneDigits: string | null;
  status: string;
  expiresAt: number;
  invitedAt: number;
};

export type ClaimAction = {
  inviteId: string;
  eventId: string;
  role: string;
  useClientId: string;
  dropPlaceholderClientId: string | null;
  createAccount: boolean;
};

export type RedeemDecision =
  | { ok: true; eventId: string; alreadyMember: boolean; countFailure: false }
  | { ok: false; status: 400 | 403 | 404 | 429; error: string; retryAfterSec?: number; countFailure: boolean };

/** Digits only. A leading US country code is dropped so both forms match. */
export function phoneMatchKey(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = phoneMatchKey(a);
  const right = phoneMatchKey(b);
  return left != null && left === right;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

export function strictEmail(raw: string | null | undefined): string | null {
  const email = normalizeEmail(raw);
  if (!email || !EMAIL_RE.test(email)) return null;
  return email;
}

export function safeAppUrl(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Env wins. Otherwise the App Store / Play / web links staff already saved. */
export function pickAppUrl(
  envUrl: string | null | undefined,
  settings?: { ios?: string | null; android?: string | null; web?: string | null } | null,
): string | null {
  return (
    safeAppUrl(envUrl) ||
    safeAppUrl(settings?.ios) ||
    safeAppUrl(settings?.android) ||
    safeAppUrl(settings?.web) ||
    null
  );
}

export function resolveJoinCodeKey(env: {
  EVENT_JOIN_CODE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  [key: string]: string | undefined;
}): string {
  const dedicated = env.EVENT_JOIN_CODE_KEY?.trim();
  if (dedicated) return dedicated;
  const fallback = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fallback) return fallback;
  throw new Error("EVENT_JOIN_CODE_KEY or SUPABASE_SERVICE_ROLE_KEY is required to seal join codes.");
}

export function scrubText(raw: string | null | undefined, max = 80): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function splitPersonName(name: string | null | undefined): { first: string; last: string } {
  const trimmed = scrubText(name, 120);
  if (!trimmed) return { first: DEFAULT_PARTNER_ROLE, last: "" };
  const space = trimmed.indexOf(" ");
  if (space === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, space), last: trimmed.slice(space + 1) };
}

export function cleanRole(raw: string | null | undefined): string {
  const role = scrubText(raw, 60).replace(/[<>]/g, "");
  return role || DEFAULT_PARTNER_ROLE;
}

/** Only a linked couple member (host). Guests and staff use other doors. */
export function coupleManageDecision(role: CoupleRole): "ok" | "forbidden" {
  return role === "host" ? "ok" : "forbidden";
}

/** A brand-new login, or a client login, can join. Staff and guest logins cannot. */
export function canRedeemJoinCode(accountType: AccountKind): boolean {
  return accountType == null || accountType === "client";
}

export function canRemoveCoupleMember(member: {
  onEvent: boolean;
  isContractHolder: boolean;
  isPrimary: boolean;
  isAnchor: boolean;
}): "ok" | "protected" | "missing" {
  if (!member.onEvent) return "missing";
  if (member.isContractHolder || member.isPrimary || member.isAnchor) return "protected";
  return "ok";
}

export function inviteExpiry(now: number): number {
  return now + INVITE_TTL_MS;
}

export function joinCodeExpiry(now: number): number {
  return now + JOIN_CODE_TTL_MS;
}

export function joinLinkExpiry(now: number): number {
  return now + JOIN_LINK_TTL_MS;
}

export function visibleInviteStatus(
  status: string,
  expiresAt: number,
  now: number,
): "pending" | "accepted" | "revoked" | "expired" {
  if (status === "accepted" || status === "revoked") return status;
  if (status === "pending" && expiresAt <= now) return "expired";
  if (status === "pending") return "pending";
  return "expired";
}

export function canResendInvite(status: string, expiresAt: number, now: number): boolean {
  const visible = visibleInviteStatus(status, expiresAt, now);
  return visible === "pending" || visible === "expired";
}

export function normalizeJoinCode(raw: string | null | undefined): string | null {
  const compact = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "");
  if (compact.length !== JOIN_CODE_LENGTH) return null;
  for (const ch of compact) {
    if (!JOIN_ALPHABET.includes(ch) || AMBIGUOUS.has(ch)) return null;
  }
  return compact;
}

export function formatJoinCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function generateJoinCode(random: (max: number) => number = (max) => randomInt(max)): string {
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += JOIN_ALPHABET[random(JOIN_ALPHABET.length)] ?? "A";
  return out;
}

export function hashJoinCode(code: string, key: string): string | null {
  const normalized = normalizeJoinCode(code);
  if (!normalized || !key) return null;
  return createHmac("sha256", key).update(normalized).digest("hex");
}

function aesKey(key: string): CipherKey {
  return createHash("sha256").update(key).digest();
}

export function encryptJoinCode(code: string, key: string): string {
  const normalized = normalizeJoinCode(code);
  if (!normalized) throw new Error("Join code is not valid.");
  const iv = Buffer.from(Array.from({ length: 12 }, () => randomInt(256)));
  const cipher = createCipheriv("aes-256-gcm", aesKey(key), iv);
  const enc = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptJoinCode(payload: string, key: string): string | null {
  const out = openText(payload, key);
  return out ? normalizeJoinCode(out) : null;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

/** Path token. Case-sensitive. Exactly 128 bits of base64url, no padding. */
export function normalizeJoinToken(raw: string | null | undefined): string | null {
  const token = String(raw ?? "").trim();
  return TOKEN_RE.test(token) ? token : null;
}

export function generateJoinToken(): string {
  return randomBytes(16).toString("base64url");
}

export function hashJoinToken(token: string, key: string): string | null {
  const normalized = normalizeJoinToken(token);
  if (!normalized || !key) return null;
  return createHmac("sha256", key).update(`link:${normalized}`).digest("hex");
}

export function encryptJoinToken(token: string, key: string): string {
  const normalized = normalizeJoinToken(token);
  if (!normalized) throw new Error("Join link is not valid.");
  return sealText(normalized, key);
}

export function decryptJoinToken(payload: string, key: string): string | null {
  const out = openText(payload, key);
  return out ? normalizeJoinToken(out) : null;
}

export function joinLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/j/${token}`;
}

/** Custom scheme the iOS app registers. Safari on this site will not hand a
    same-domain https link to the app, so the landing button uses this. */
/** Keep in step with CLIENT_APP_SCHEME in src/lib/clientApp.ts. */
export function appJoinScheme(token: string): string {
  return `xpressclient://j/${token}`;
}

function sealText(value: string, key: string): string {
  const iv = Buffer.from(randomBytes(12));
  const cipher = createCipheriv("aes-256-gcm", aesKey(key), iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function openText(payload: string, key: string): string | null {
  try {
    const [ivB, tagB, dataB] = String(payload ?? "").split(".");
    if (!ivB || !tagB || !dataB) return null;
    const decipher = createDecipheriv("aes-256-gcm", aesKey(key), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function rateLimitDecision(
  failureTimes: number[],
  now: number,
  limit: number,
  windowMs: number,
): { blocked: boolean; retryAfterSec: number } {
  const recent = failureTimes.filter((t) => now - t < windowMs && now - t >= 0).sort((a, b) => a - b);
  if (recent.length < limit) return { blocked: false, retryAfterSec: 0 };
  const retryAfterSec = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
  return { blocked: true, retryAfterSec };
}

export function evaluateRedeem(input: {
  accountType: AccountKind;
  rawCode: string;
  now: number;
  userFailures: number[];
  ipFailures: number[];
  match: { eventId: string; expiresAt: number } | null;
  alreadyOnEvent: boolean;
}): RedeemDecision {
  if (!canRedeemJoinCode(input.accountType)) {
    const error =
      input.accountType === "staff"
        ? "This is a staff login. Use the couple's own phone or email to join the app."
        : "This login is a guest login, so it can't join as a partner. Sign in with a phone or email of your own, or ask the couple to invite you.";
    return { ok: false, status: 403, error, countFailure: false };
  }

  const userLimit = rateLimitDecision(input.userFailures, input.now, JOIN_ATTEMPT_LIMIT, JOIN_ATTEMPT_WINDOW_MS);
  const ipLimit = rateLimitDecision(input.ipFailures, input.now, JOIN_IP_ATTEMPT_LIMIT, JOIN_ATTEMPT_WINDOW_MS);
  if (userLimit.blocked || ipLimit.blocked) {
    const retryAfterSec = Math.max(userLimit.retryAfterSec, ipLimit.retryAfterSec);
    return {
      ok: false,
      status: 429,
      error: "Too many tries. Wait an hour and try again.",
      retryAfterSec,
      countFailure: false,
    };
  }

  const normalized = normalizeJoinCode(input.rawCode);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      error: "Enter the code like ABCD-2345. It uses letters and numbers, with no 0, O, 1, I, or L.",
      countFailure: true,
    };
  }

  if (!input.match || input.match.expiresAt <= input.now) {
    return {
      ok: false,
      status: 404,
      error: "That code doesn't work. Check it and try again, or ask the couple for a new one.",
      countFailure: true,
    };
  }

  return {
    ok: true,
    eventId: input.match.eventId,
    alreadyMember: input.alreadyOnEvent,
    countFailure: false,
  };
}

export type LinkRedeemDecision =
  | { ok: true; eventId: string; role: LinkRole; alreadyMember: boolean; upgrade: boolean; countFailure: false }
  | { ok: false; status: 400 | 403 | 404 | 429; error: string; retryAfterSec?: number; countFailure: boolean };

/** Same limits as a join code. A host who opens the guest link stays a host.
    A guest who opens the host link is upgraded. */
export function evaluateLinkRedeem(input: {
  accountType: AccountKind;
  rawToken: string;
  now: number;
  userFailures: number[];
  ipFailures: number[];
  match: { eventId: string; role: LinkRole; expiresAt: number } | null;
  existingRole: LinkRole | null;
}): LinkRedeemDecision {
  if (input.accountType === "staff") {
    return {
      ok: false,
      status: 403,
      error: "This is a staff login. Use the couple's own email to join the app.",
      countFailure: false,
    };
  }

  const userLimit = rateLimitDecision(input.userFailures, input.now, JOIN_ATTEMPT_LIMIT, JOIN_ATTEMPT_WINDOW_MS);
  const ipLimit = rateLimitDecision(input.ipFailures, input.now, JOIN_IP_ATTEMPT_LIMIT, JOIN_ATTEMPT_WINDOW_MS);
  if (userLimit.blocked || ipLimit.blocked) {
    const retryAfterSec = Math.max(userLimit.retryAfterSec, ipLimit.retryAfterSec);
    return {
      ok: false,
      status: 429,
      error: "Too many tries. Wait an hour and try again.",
      retryAfterSec,
      countFailure: false,
    };
  }

  if (!normalizeJoinToken(input.rawToken)) {
    return {
      ok: false,
      status: 400,
      error: "That link isn't valid.",
      countFailure: true,
    };
  }

  if (!input.match || input.match.expiresAt <= input.now) {
    return {
      ok: false,
      status: 404,
      error: "That link doesn't work. Ask the couple or your DJ for a new one.",
      countFailure: true,
    };
  }

  if (input.existingRole === "host") {
    return {
      ok: true,
      eventId: input.match.eventId,
      role: "host",
      alreadyMember: true,
      upgrade: false,
      countFailure: false,
    };
  }

  if (input.existingRole === "guest" && input.match.role === "guest") {
    return {
      ok: true,
      eventId: input.match.eventId,
      role: "guest",
      alreadyMember: true,
      upgrade: false,
      countFailure: false,
    };
  }

  return {
    ok: true,
    eventId: input.match.eventId,
    role: input.match.role,
    alreadyMember: false,
    upgrade: input.existingRole === "guest" && input.match.role === "host",
    countFailure: false,
  };
}

/** Which pending invites this sign-in should accept, and which client to attach. */
export function planInviteClaim(input: {
  accountType: AccountKind;
  clientId: string | null;
  email: string | null;
  phoneDigits: string | null;
  invites: OpenInvite[];
  now: number;
}): { actions: ClaimAction[]; reason: "staff" | "guest" | "none" | "linked" } {
  if (input.accountType === "staff") return { actions: [], reason: "staff" };
  if (input.accountType === "event_guest") return { actions: [], reason: "guest" };

  const email = normalizeEmail(input.email);
  const phone = phoneMatchKey(input.phoneDigits);
  const matches = input.invites
    .filter((inv) => inv.status === "pending" && inv.expiresAt > input.now && inv.clientId)
    .filter((inv) => {
      const emailHit = email != null && normalizeEmail(inv.email) === email;
      const phoneHit = phone != null && phoneMatchKey(inv.phoneDigits) === phone;
      return emailHit || phoneHit;
    })
    .sort((a, b) => a.invitedAt - b.invitedAt);

  if (matches.length === 0) return { actions: [], reason: "none" };

  let clientId = input.clientId;
  let createAccount = input.clientId == null;
  const actions: ClaimAction[] = [];

  for (const inv of matches) {
    const inviteClient = inv.clientId as string;
    if (!clientId) {
      clientId = inviteClient;
      createAccount = true;
    }
    const drop =
      inv.createdClient && inviteClient !== clientId ? inviteClient : null;
    actions.push({
      inviteId: inv.id,
      eventId: inv.eventId,
      role: cleanRole(inv.role),
      useClientId: clientId,
      dropPlaceholderClientId: drop,
      createAccount,
    });
    createAccount = false;
  }

  return { actions, reason: "linked" };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatLongDate(epochMs: number, timeZone: string, lang: "en" | "es"): string {
  const zone = timeZone || "America/New_York";
  return new Intl.DateTimeFormat(lang === "es" ? "es" : "en", { dateStyle: "long", timeZone: zone }).format(
    new Date(epochMs),
  );
}

export function clientCellPhone(raw: string | null | undefined): string | null {
  return formatPhone(raw ?? null);
}

export type ParsedInvite =
  | {
      ok: true;
      email: string | null;
      phoneE164: string | null;
      phoneDigits: string | null;
      name: string | null;
      firstName: string;
      lastName: string;
      role: string;
      lang: InviteLang;
    }
  | { ok: false; error: string };

export function parseInviteInput(body: unknown): ParsedInvite {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const email = strictEmail(typeof record.email === "string" ? record.email : null);
  const phoneRaw = typeof record.phone === "string" ? record.phone : "";
  const phoneE164 = phoneRaw.trim() ? toE164(phoneRaw) : null;
  if (phoneRaw.trim() && !phoneE164) {
    return { ok: false, error: "That phone number doesn't look right. Use a mobile number like 305-555-0199." };
  }
  if (!email && !phoneE164) {
    return { ok: false, error: "Add a phone number or an email." };
  }
  const name = scrubText(typeof record.name === "string" ? record.name : "", 120) || null;
  const parts = splitPersonName(name);
  const langRaw = typeof record.lang === "string" ? record.lang.trim().toLowerCase() : "";
  const lang: InviteLang = langRaw === "en" || langRaw === "es" || langRaw === "both" ? langRaw : "both";
  return {
    ok: true,
    email,
    phoneE164,
    phoneDigits: phoneMatchKey(phoneE164),
    name,
    firstName: parts.first,
    lastName: parts.last,
    role: cleanRole(typeof record.role === "string" ? record.role : null),
    lang,
  };
}

function button(href: string, label: string): string {
  return `<div style="text-align:center;margin:22px 0;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#4b328e;background:linear-gradient(110deg,#4b328e,#8b6fd6);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:10px;">${escapeHtml(label)}</a>
  </div>`;
}

function codeBlock(code: string): string {
  return `<div style="text-align:center;margin:8px 0 18px;">
    <span style="display:inline-block;font-size:28px;letter-spacing:4px;font-weight:800;color:#4b328e;background:#f4f1fb;border:1px solid #e4ddf7;border-radius:12px;padding:14px 18px;">${escapeHtml(code)}</span>
  </div>`;
}

export function inviteMessage(opts: {
  inviter: string;
  eventName: string;
  url: string | null;
  /** Host join link. Included raw so the person can open it after they install the app. */
  joinUrl?: string | null;
  channel: "sms" | "email";
  lang: InviteLang;
}): { sms: string; subject: string; html: string; loggedHtml: string } {
  const inviter = scrubText(opts.inviter, 80) || "Someone";
  const eventName = scrubText(opts.eventName, 120) || "your event";
  const url = safeAppUrl(opts.url);
  const langs: Array<"en" | "es"> = opts.lang === "both" ? ["en", "es"] : [opts.lang];

  const joinUrl = safeAppUrl(opts.joinUrl);
  const smsParts = langs.map((lang) => smsLine(lang, inviter, eventName, url, opts.channel, joinUrl));
  const htmlParts = langs.map((lang) => emailBlock(lang, inviter, eventName, url, opts.channel, joinUrl));
  const subject =
    opts.lang === "es"
      ? "Te invitaron a un evento en la app de Xpress"
      : "You're invited to an event in the Xpress app";

  return {
    sms: smsParts.join("\n\n"),
    subject,
    html: htmlParts.join('<hr style="border:none;border-top:1px solid #eceaf3;margin:22px 0;" />'),
    loggedHtml: htmlParts.join('<hr style="border:none;border-top:1px solid #eceaf3;margin:22px 0;" />'),
  };
}

function smsLine(
  lang: "en" | "es",
  inviter: string,
  eventName: string,
  url: string | null,
  _channel: "sms" | "email",
  joinUrl: string | null,
): string {
  const where = url
    ? lang === "es"
      ? `Descárgala aquí: ${url}`
      : `Download it here: ${url}`
    : lang === "es"
      ? "Búscala en el App Store como Xpress Entertainment."
      : "Search the App Store for Xpress Entertainment.";
  const signIn =
    lang === "es"
      ? "Entra con tu correo y una contraseña, o con Apple o Google. Si el correo o el teléfono de esa cuenta coincide, te agregamos al evento."
      : "Sign in with your email and a password, or with Apple or Google. If that login's email or phone matches, we'll add you to the event.";
  const link = joinUrl ? (lang === "es" ? ` O abre este enlace: ${joinUrl}` : ` Or open this link: ${joinUrl}`) : "";
  if (lang === "es") {
    return `${inviter} te invitó a ${eventName} en la app de Xpress. ${where} ${signIn}${link} Esta invitación vence en 14 días.`;
  }
  return `${inviter} invited you to ${eventName} in the Xpress app. ${where} ${signIn}${link} This invite expires in 14 days.`;
}

function emailBlock(
  lang: "en" | "es",
  inviter: string,
  eventName: string,
  url: string | null,
  _channel: "sms" | "email",
  joinUrl: string | null,
): string {
  const safeInviter = escapeHtml(inviter);
  const safeEvent = escapeHtml(eventName);
  const signIn =
    lang === "es"
      ? "Entra con tu correo y una contraseña, o con Apple o Google. Te agregamos cuando el correo o el teléfono de esa cuenta coincida con esta invitación."
      : "Sign in with your email and a password, or with Apple or Google. We'll add you when that login's email or phone matches this invite.";
  const link = joinUrl
    ? `<p style="font-size:14px;color:#4a4a52;line-height:1.6;margin:8px 0;">${lang === "es" ? "O abre este enlace" : "Or open this link"}: <a href="${escapeHtml(joinUrl)}">${escapeHtml(joinUrl)}</a></p>`
    : "";
  const store = url
    ? button(url, lang === "es" ? "Abrir la app" : "Open the app")
    : lang === "es"
      ? "<p>Busca Xpress Entertainment en el App Store.</p>"
      : "<p>Search the App Store for Xpress Entertainment.</p>";
  if (lang === "es") {
    return `<p style="font-size:15px;color:#1d1d22;margin:0 0 10px;">Hola,</p>
      <p style="font-size:14px;color:#4a4a52;line-height:1.6;margin:0 0 6px;">${safeInviter} te invitó a <strong>${safeEvent}</strong> en la app de Xpress. ${signIn} Tendrás el mismo acceso que la pareja. Esta invitación vence en 14 días.</p>
      ${link}
      ${store}`;
  }
  return `<p style="font-size:15px;color:#1d1d22;margin:0 0 10px;">Hello,</p>
    <p style="font-size:14px;color:#4a4a52;line-height:1.6;margin:0 0 6px;">${safeInviter} invited you to <strong>${safeEvent}</strong> in the Xpress app. ${signIn} You'll have the same access as the couple. This invite expires in 14 days.</p>
    ${link}
    ${store}`;
}

export function joinCodeEmailSection(opts: {
  code: string | null;
  eventName: string;
  expiresAt: number;
  timeZone: string;
  url: string | null;
  redact?: boolean;
}): { html: string; subject: string } {
  const eventName = scrubText(opts.eventName, 120) || "your event";
  const safeEvent = escapeHtml(eventName);
  const enDate = formatLongDate(opts.expiresAt, opts.timeZone, "en");
  const esDate = formatLongDate(opts.expiresAt, opts.timeZone, "es");
  const url = safeAppUrl(opts.url);
  const shown = opts.redact || !opts.code ? null : formatJoinCode(opts.code);
  const codeHtml = shown
    ? codeBlock(shown)
    : `<p style="font-size:14px;color:#8a8a94;">The join code is hidden in this copy of the email.</p>`;
  const store = url ? button(url, "Open the app") : "";
  const html = `<div>
    <p style="font-size:15px;color:#1d1d22;margin:0 0 10px;">Your event code</p>
    <p style="font-size:14px;color:#4a4a52;line-height:1.6;margin:0 0 6px;">Share this code with your partner so they can join <strong>${safeEvent}</strong> in the Xpress app. They'll have the same access you do. The code expires on ${escapeHtml(enDate)}.</p>
    ${codeHtml}
    ${store}
    <p style="font-size:15px;color:#1d1d22;margin:18px 0 10px;">El código de tu evento</p>
    <p style="font-size:14px;color:#4a4a52;line-height:1.6;margin:0 0 6px;">Comparte este código con tu pareja para que se una a <strong>${safeEvent}</strong> en la app de Xpress. Tendrá el mismo acceso que tú. El código vence el ${escapeHtml(esDate)}.</p>
    ${shown ? codeBlock(shown) : ""}
  </div>`;
  return { html, subject: `Your code for ${eventName}` };
}

/** Replace <app_join_code> or append the section when the template has no tag. */
export function placeAppJoinCode(body: string, section: string): string {
  const tag = /(?:<app_join_code>|&lt;app_join_code&gt;|%3Capp_join_code%3E)/gi;
  if (!tag.test(body)) return `${body}${section}`;
  tag.lastIndex = 0;
  return body.replace(tag, () => section);
}

/** Replace host and guest link tags with the raw URL. Missing values become empty. */
export function placeJoinLinkTags(body: string, links: { host?: string | null; guest?: string | null }): string {
  let out = body;
  const pairs: Array<[string, string]> = [
    ["app_host_link", links.host ?? ""],
    ["app_guest_link", links.guest ?? ""],
  ];
  for (const [tag, value] of pairs) {
    const re = new RegExp(`(?:<${tag}>|&lt;${tag}&gt;|%3C${tag}%3E)`, "gi");
    out = out.replace(re, () => value);
  }
  return out;
}

/** True when the HTML already contains a real /j/<token> URL. */
export function htmlHasJoinLink(html: string): boolean {
  return /\/j\/[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])/.test(html);
}

export function deliveryChannel(email: string | null, phone: string | null): "sms" | "email" | "sms_and_email" {
  if (email && phone) return "sms_and_email";
  if (phone) return "sms";
  return "email";
}

export function holderRank(row: { isContractHolder: boolean; isPrimary: boolean }): number {
  if (row.isContractHolder) return 0;
  if (row.isPrimary) return 1;
  return 2;
}
