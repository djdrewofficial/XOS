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
