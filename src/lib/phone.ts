/* Phone normalization — XOS always uses the dashed US format (612-555-1212).
   Controlled by company_settings.phone_format_enabled (General settings). */
export function formatPhone(raw: string | null): string | null {
  if (!raw) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw; // international / extensions — leave as typed
}

/* Normalize to E.164 (+15551234567) for provider APIs and as the opt-out list
   key. Returns null when it isn't a recognizable US number. */
export function toE164(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.startsWith("+")) return `+${trimmed.replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
