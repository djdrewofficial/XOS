const SENSITIVE_KEY =
  /password|secret|token|api[_-]?key|authorization|service[_-]?role|cookie|cvv|ssn|card|bearer|private[_-]?key|webhook/i;

const MAX_STRING = 500;

/** Drop secret-shaped fields and any string that contains a known secret value.
    Used for audit rows and for tool results before they leave the process. */
export function redact(value: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") return redactString(value, secrets);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, secrets, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(child, secrets, depth + 1);
    }
    return out;
  }
  return "[unsupported]";
}

function redactString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length >= 8 && out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  if (out.length > MAX_STRING) return `${out.slice(0, MAX_STRING)}…`;
  return out;
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
