// Configurable "signing requirements" — the info the office should collect on an
// event before a couple signs their contract. Warn-only: nothing here BLOCKS a
// send or signature; it just surfaces what's still missing.
//
// Config lives in two places (see migration 00049):
//   journey_settings.required_signing_fields  — the global default list
//   event_types.required_signing_fields       — per-type override (null = inherit)

export type SigningFieldKey =
  | "contract_holder"
  | "partner_a_name"
  | "partner_a_contact"
  | "partner_b_name"
  | "partner_b_contact"
  | "venue_name"
  | "venue_address"
  | "package"
  | "payment_schedule"
  | "event_date"
  | "estimated_times";

export const SIGNING_FIELDS: { key: SigningFieldKey; label: string; hint: string }[] = [
  { key: "contract_holder", label: "Contract Holder", hint: "A primary client is set on the event" },
  { key: "partner_a_name", label: "Partner A — Name", hint: "Primary client has first & last name" },
  { key: "partner_a_contact", label: "Partner A — Contact", hint: "Primary client has an email or cell" },
  { key: "partner_b_name", label: "Partner B — Name", hint: "Second client has first & last name" },
  { key: "partner_b_contact", label: "Partner B — Contact", hint: "Second client has an email or cell" },
  { key: "venue_name", label: "Venue Name", hint: "A venue is attached to the event" },
  { key: "venue_address", label: "Venue Address", hint: "The attached venue has a street address" },
  { key: "package", label: "Package", hint: "A package is selected" },
  { key: "payment_schedule", label: "Payment Schedule", hint: "At least one scheduled payment exists" },
  { key: "event_date", label: "Event Date", hint: "The event date is set" },
  { key: "estimated_times", label: "Estimated Times", hint: "Start & end times are set (estimates are fine)" },
];

export const DEFAULT_REQUIRED: SigningFieldKey[] = SIGNING_FIELDS.map((f) => f.key);

const ALL_KEYS = new Set<string>(DEFAULT_REQUIRED);
/** Keep only keys we know about (drops stale config from removed fields). */
export function sanitizeKeys(keys: readonly string[] | null | undefined): SigningFieldKey[] {
  return (keys ?? []).filter((k): k is SigningFieldKey => ALL_KEYS.has(k));
}

/** Resolve which fields are required for an event: per-type override wins, then
 *  the global default, then the built-in default if neither is configured. */
export function resolveRequiredFields(
  typeOverride: readonly string[] | null | undefined,
  global: readonly string[] | null | undefined
): SigningFieldKey[] {
  if (typeOverride != null) return sanitizeKeys(typeOverride);
  if (global != null) return sanitizeKeys(global);
  return [...DEFAULT_REQUIRED];
}

type ClientLite = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  cell_phone?: string | null;
} | null;

export type SigningBundle = {
  event: {
    event_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    package_id?: string | null;
    venue_id?: string | null;
  };
  venue: { name?: string | null; address?: string | null } | null;
  eventClients: { is_primary: boolean; is_contract_holder?: boolean; client: ClientLite }[];
  scheduleCount: number;
};

const has = (v: unknown) => typeof v === "string" && v.trim() !== "";
const hasContact = (c: ClientLite) => has(c?.email) || has(c?.cell_phone);

const CHECKS: Record<SigningFieldKey, (b: SigningBundle) => boolean> = {
  // explicit contract-holder flag, falling back to the primary client for events
  // created before the flag existed
  contract_holder: (b) =>
    b.eventClients.some((ec) => ec.is_contract_holder && ec.client != null) ||
    b.eventClients.some((ec) => ec.is_primary && ec.client != null),
  partner_a_name: (b) => {
    const p = b.eventClients.find((ec) => ec.is_primary)?.client;
    return has(p?.first_name) && has(p?.last_name);
  },
  partner_a_contact: (b) => hasContact(b.eventClients.find((ec) => ec.is_primary)?.client ?? null),
  partner_b_name: (b) => {
    const p = b.eventClients.find((ec) => !ec.is_primary)?.client;
    return has(p?.first_name) && has(p?.last_name);
  },
  partner_b_contact: (b) => b.eventClients.some((ec) => !ec.is_primary && hasContact(ec.client)),
  venue_name: (b) => !!b.event.venue_id && has(b.venue?.name),
  venue_address: (b) => has(b.venue?.address),
  package: (b) => !!b.event.package_id,
  payment_schedule: (b) => b.scheduleCount > 0,
  event_date: (b) => has(b.event.event_date),
  estimated_times: (b) => has(b.event.start_time) && has(b.event.end_time),
};

/** Returns the required fields still missing for this event (label + key). */
export function getMissingSigningFields(
  required: readonly SigningFieldKey[],
  b: SigningBundle
): { key: SigningFieldKey; label: string }[] {
  const labels = new Map(SIGNING_FIELDS.map((f) => [f.key, f.label]));
  return required
    .filter((k) => !CHECKS[k](b))
    .map((k) => ({ key: k, label: labels.get(k) ?? k }));
}
