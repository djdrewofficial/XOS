import { createHash, createHmac, timingSafeEqual } from "crypto";

/* Supabase Auth "Send SMS" hook (phone OTP for the xpress-client app).
   Supabase POSTs { user.phone, sms.otp } signed with Standard Webhooks.
   GoTrue only forwards a hook's error.message when the HTTP status is 200 or
   202 (auth/internal/hooks/hookshttp). A 4xx/5xx is replaced with a generic
   sentence and the real reason never reaches the app. After the signature
   headers are present, this handler always answers 200:
     success → {}
     failure → { error: { http_code, message } }
   Requests with no webhook headers are refused with HTTP 401. */

export const LOGIN_CODE_EXPIRY_MINUTES = 10;
export const OTP_LENGTH = 6;

const TIMESTAMP_TOLERANCE_SEC = 5 * 60;
const MAX_BODY_BYTES = 24 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const PHONE_MAX_PER_WINDOW = 8;
const GLOBAL_MAX_PER_WINDOW = 60;
const MAX_TRACKED = 2000;

export type SendSmsResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

export type SendSmsFn = (opts: { phone: string; body: string }) => Promise<SendSmsResult>;

export type SendSmsGuards = {
  deliveredIds: Map<string, number>;
  deliveredCodes: Map<string, number>;
  phoneAttempts: Map<string, number[]>;
  globalAttempts: number[];
};

export function createSendSmsGuards(): SendSmsGuards {
  return {
    deliveredIds: new Map(),
    deliveredCodes: new Map(),
    phoneAttempts: new Map(),
    globalAttempts: [],
  };
}

const sharedGuards = createSendSmsGuards();

export type SendSmsHookDeps = {
  sendSms: SendSmsFn;
  /** XOS phone normalizer (toE164). Injected so this module stays free of server imports. */
  normalizePhone: (raw: string) => string | null;
  /** Full dashboard secret, usually `v1,whsec_<base64>`. Several may be listed for rotation. */
  secret?: string | null;
  now?: () => number;
  log?: (message: string, fields?: Record<string, string>) => void;
  guards?: SendSmsGuards;
};

/** "Your Xpress code is 123456. It expires in 10 minutes." */
export function loginCodeSms(otp: string): string {
  return `Your Xpress code is ${otp}. It expires in ${LOGIN_CODE_EXPIRY_MINUTES} minutes.`;
}

/** Symmetric keys from a Send SMS hook secret. Strips the `v1,whsec_` prefix GoTrue adds. */
export function hookSecretKeys(raw: string | null | undefined): Buffer[] {
  if (!raw) return [];
  const prefixed = [...raw.matchAll(/v1,whsec_([A-Za-z0-9+/]+={0,2})/g)];
  if (prefixed.length) {
    return prefixed
      .map((match) => Buffer.from(match[1], "base64"))
      .filter((key) => key.length > 0);
  }
  let bare = raw.trim();
  if (bare.startsWith("whsec_")) bare = bare.slice("whsec_".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(bare)) return [];
  const key = Buffer.from(bare, "base64");
  return key.length ? [key] : [];
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing-headers" | "invalid" };

/** Standard Webhooks: HMAC-SHA256 over `id.timestamp.rawBody`, header `v1,<base64>`.
    GoTrue joins multiple signatures with ", " — both that and the spec's space join are accepted. */
export function verifySendSmsSignature(opts: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSec: number;
}): SignatureCheck {
  if (!opts.id || !opts.timestamp || !opts.signature) return { ok: false, reason: "missing-headers" };
  const keys = hookSecretKeys(opts.secret);
  if (!keys.length || !/^\d{1,12}$/.test(opts.timestamp)) return { ok: false, reason: "invalid" };
  const ts = Number(opts.timestamp);
  if (Math.abs(opts.nowSec - ts) > TIMESTAMP_TOLERANCE_SEC) return { ok: false, reason: "invalid" };
  const provided = [...opts.signature.matchAll(/v1,([A-Za-z0-9+/]+={0,2})/g)].map((match) => match[1]);
  if (!provided.length) return { ok: false, reason: "invalid" };
  const signed = `${opts.id}.${opts.timestamp}.${opts.body}`;
  let match = false;
  for (const key of keys) {
    const expected = createHmac("sha256", key).update(signed).digest("base64");
    for (const sig of provided) match = safeEqual(expected, sig) || match;
  }
  return match ? { ok: true } : { ok: false, reason: "invalid" };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function success(): Response {
  return json(200, {});
}

/** HTTP 200 so GoTrue propagates `message` (and `http_code`) to the client. */
function surfaced(httpCode: number, message: string): Response {
  return json(200, { error: { http_code: httpCode, message } });
}

function phoneTail(phone: string): string {
  return phone.slice(-4);
}

function codeKey(phone: string, otp: string): string {
  return createHash("sha256").update(`${phone}:${otp}`).digest("hex");
}

function sweep(guards: SendSmsGuards, now: number) {
  for (const [id, exp] of guards.deliveredIds) {
    if (exp <= now) guards.deliveredIds.delete(id);
  }
  for (const [id, exp] of guards.deliveredCodes) {
    if (exp <= now) guards.deliveredCodes.delete(id);
  }
  guards.globalAttempts = guards.globalAttempts.filter((t) => now - t < WINDOW_MS);
}

function remember(map: Map<string, number>, key: string, exp: number) {
  if (!map.has(key) && map.size >= MAX_TRACKED) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, exp);
}

function withinRateLimit(guards: SendSmsGuards, phone: string, now: number): boolean {
  const hits = (guards.phoneAttempts.get(phone) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= PHONE_MAX_PER_WINDOW || guards.globalAttempts.length >= GLOBAL_MAX_PER_WINDOW) {
    if (!guards.phoneAttempts.has(phone) && guards.phoneAttempts.size >= MAX_TRACKED) {
      const oldest = guards.phoneAttempts.keys().next().value;
      if (oldest !== undefined) guards.phoneAttempts.delete(oldest);
    }
    guards.phoneAttempts.set(phone, hits);
    return false;
  }
  hits.push(now);
  guards.globalAttempts.push(now);
  guards.phoneAttempts.set(phone, hits);
  return true;
}

function providerReason(error: string, secrets: string[]): string {
  let text = error;
  const hide = secrets.filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of hide) text = text.split(secret).join("");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 180) text = `${text.slice(0, 180)}…`;
  return text;
}

function readOtp(body: string): { phone: string; otp: string } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { error: "Send SMS hook payload was not valid JSON." };
  }
  if (!data || typeof data !== "object") return { error: "Send SMS hook payload was empty." };
  const record = data as { user?: { phone?: unknown }; sms?: { otp?: unknown; phone?: unknown } };
  const userPhone = typeof record.user?.phone === "string" ? record.user.phone.trim() : "";
  const smsPhone = typeof record.sms?.phone === "string" ? record.sms.phone.trim() : "";
  const phone = userPhone || smsPhone;
  const otp = typeof record.sms?.otp === "string" ? record.sms.otp.trim() : "";
  if (!phone) return { error: "user.phone is missing." };
  if (!/^\d{6}$/.test(otp)) return { error: "sms.otp must be a 6-digit code." };
  return { phone, otp };
}

function normalizeHookPhone(raw: string, normalizePhone: (value: string) => string | null): string | null {
  const e164 = normalizePhone(raw);
  if (!e164 || !/^\+\d{10,15}$/.test(e164)) return null;
  return e164;
}

export async function handleSendSmsHook(req: Request, deps: SendSmsHookDeps): Promise<Response> {
  const now = deps.now ? deps.now() : Date.now();
  const log = deps.log ?? ((message, fields) => console.error(message, fields ?? ""));
  const guards = deps.guards ?? sharedGuards;
  const secret = deps.secret ?? "";

  if (req.method !== "POST") {
    return json(405, { error: { http_code: 405, message: "Method not allowed." } });
  }

  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json(401, { error: { http_code: 401, message: "Unauthorized" } });
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return json(401, { error: { http_code: 401, message: "Unauthorized" } });
  }
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    return json(401, { error: { http_code: 401, message: "Unauthorized" } });
  }

  if (!hookSecretKeys(secret).length) {
    log("send-sms hook: SEND_SMS_HOOK_SECRET is not configured", {});
    return surfaced(500, "SEND_SMS_HOOK_SECRET is not configured.");
  }

  const webhookId = req.headers.get("webhook-id");
  const check = verifySendSmsSignature({
    secret,
    id: webhookId,
    timestamp: req.headers.get("webhook-timestamp"),
    signature: req.headers.get("webhook-signature"),
    body,
    nowSec: Math.floor(now / 1000),
  });
  if (!check.ok) {
    if (check.reason === "missing-headers") {
      return json(401, { error: { http_code: 401, message: "Unauthorized" } });
    }
    return surfaced(401, "The Send SMS hook signature is not valid.");
  }
  if (!webhookId || webhookId.length > 256) {
    return surfaced(400, "The Send SMS hook id is not valid.");
  }

  const parsed = readOtp(body);
  if ("error" in parsed) return surfaced(400, parsed.error);
  const phone = normalizeHookPhone(parsed.phone, deps.normalizePhone);
  if (!phone) return surfaced(400, "user.phone is missing or not a valid phone number.");

  sweep(guards, now);
  const code = codeKey(phone, parsed.otp);
  if (
    (guards.deliveredIds.get(webhookId) ?? 0) > now ||
    (guards.deliveredCodes.get(code) ?? 0) > now
  ) {
    return success();
  }

  if (!withinRateLimit(guards, phone, now)) {
    log("send-sms hook rate limited", { phoneTail: phoneTail(phone) });
    return surfaced(429, "Too many login codes for this number. Try again in a few minutes.");
  }

  const text = loginCodeSms(parsed.otp);
  let result: SendSmsResult;
  try {
    result = await deps.sendSms({ phone, body: text });
  } catch {
    log("send-sms hook send threw", { phoneTail: phoneTail(phone) });
    return surfaced(500, "Could not send the login code.");
  }
  if (!result.ok) {
    if (result.error === "HighLevel not configured") {
      log("send-sms hook: HighLevel is not configured", { phoneTail: phoneTail(phone) });
      return surfaced(500, "HighLevel is not configured.");
    }
    const reason = providerReason(result.error, [text, parsed.otp]);
    log("send-sms hook send failed", { phoneTail: phoneTail(phone), reason });
    if (!reason || reason.includes(parsed.otp)) return surfaced(500, "Could not send the login code.");
    return surfaced(500, `Could not send the login code. ${reason}`);
  }

  const exp = now + WINDOW_MS;
  remember(guards.deliveredIds, webhookId, exp);
  remember(guards.deliveredCodes, code, exp);
  return success();
}
