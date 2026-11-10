const SENSITIVE_KEY =
  /password|secret|token|api[_-]?key|authorization|service[_-]?role|cookie|cvv|ssn|card|bearer|private[_-]?key|webhook/i;

const AUDIT_DROP = /body|html|note|content|preview|message|subject/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;

/** Remove known secrets and secret-shaped fields. Does not shorten text or lists.
    Approval receipts and tool results use this so a preview cannot silently
    differ from what would run. */
export function redact(value: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (depth > 20) return "[depth limit]";
  if (typeof value === "string") return stripSecrets(value, secrets);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(child, secrets, depth + 1);
    }
    return out;
  }
  return "[unsupported]";
}

/** Audit rows keep identifiers and outcomes. Message bodies, subjects, and
    contact details are not stored. */
export function auditView(value: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (depth > 8) return "[omitted]";
  if (typeof value === "string") {
    const clean = stripSecrets(value, secrets).replace(EMAIL, "[email]").replace(PHONE, "[phone]");
    return clean.length > 120 ? `[text ${clean.length} chars]` : clean;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    return { count: value.length, sample: value.slice(0, 5).map((item) => auditView(item, secrets, depth + 1)) };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key) || AUDIT_DROP.test(key)) {
        out[key] = "[omitted]";
      } else {
        out[key] = auditView(child, secrets, depth + 1);
      }
    }
    return out;
  }
  return "[unsupported]";
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;

function capabilityUrl(url: string): boolean {
  return /\/(?:sign|pay|proposal|offer|welcome|vibo|unsubscribe|j|p)\//i.test(url)
    || /[?&#]token=/i.test(url)
    || /\/object\/sign\//i.test(url);
}

function redactCapabilityUrls(value: string): string {
  return value.replace(URL_IN_TEXT, (url) => (capabilityUrl(url) ? "[client link]" : url));
}

const CLIENT_LINK_KEY = /^(signing_url|payment_url|proposal_url|join_url|guest_url|access_token|pay_token)$/i;

/** Client-facing secret links stay in the admin approval record. Agent responses
    and the audit log only see a placeholder. */
export function hideClientLinks(value: unknown, depth = 0): unknown {
  if (depth > 20) return value;
  if (typeof value === "string") return redactCapabilityUrls(value);
  if (Array.isArray(value)) return value.map((item) => hideClientLinks(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = CLIENT_LINK_KEY.test(key) ? "[client link]" : hideClientLinks(child, depth + 1);
    }
    return out;
  }
  return value;
}

function stripSecrets(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length >= 8 && out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return redactCapabilityUrls(out);
}

/** Env values that must never appear in a tool result, audit row, or log line. */
export function secretValuesFromEnv(env: Record<string, string | undefined>): string[] {
  const keys = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "MAILGUN_API_KEY",
    "MAILGUN_SIGNING_KEY",
    "HIGHLEVEL_PI_TOKEN",
    "HIGHLEVEL_API_KEY",
    "CRON_SECRET",
    "ORIGIN_VERIFY_SECRET",
    "PAYPAL_CLIENT_SECRET",
    "SEND_SMS_HOOK_SECRET",
    "GHL_MARKETPLACE_CLIENT_SECRET",
    "FIREFLIES_API_KEY",
    "SPOTIFY_CLIENT_SECRET",
    "OPENAI_API_KEY",
  ];
  const values: string[] = [];
  for (const key of keys) {
    const value = env[key];
    if (value && value.length >= 8) values.push(value);
  }
  return values;
}
