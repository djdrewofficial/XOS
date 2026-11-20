/**
 * Recipient selection for booking-helper email/SMS steps and
 * documents_send_for_signature.
 *
 * Template-level modes live on each send action's `recipients` object.
 * Per-run overrides (staff checkboxes) pass exact client ids when a helper
 * runs on an event. Existing helpers with no `recipients` key keep today's
 * behavior: primary client only (`mode: "default"`).
 */

export type RecipientMode =
  | "default"
  | "all"
  | "primary"
  | "contract_holder"
  | "roles";

/** Semantic role keys (template level) plus free-text event_clients.role match. */
export type RecipientRoleKey =
  | "primary"
  | "contract_holder"
  | "all_clients"
  | "planner"
  | "bride"
  | "groom"
  | "client"
  | (string & {});

export type HelperRecipientConfig = {
  mode: RecipientMode;
  /** Used when mode === "roles". Semantic keys and/or free-text roles. */
  roles?: string[];
};

export type EventContact = {
  clientId: string;
  eventClientId?: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
  isContractHolder: boolean;
};

export type ResolvedRecipient = EventContact & {
  /** Why this contact was included (for UI). */
  matchedBy: string[];
};

export type RecipientChannel = "email" | "sms";

export type RecipientResolution = {
  selected: ResolvedRecipient[];
  /** Contacts that matched the mode/roles/override but lack email or phone. */
  missingChannel: ResolvedRecipient[];
  /** Human-readable warnings for the confirm UI. */
  warnings: string[];
};

export const RECIPIENT_MODE_OPTIONS: { value: RecipientMode; label: string; hint: string }[] = [
  {
    value: "default",
    label: "Default (primary client)",
    hint: "Same as today: the event's primary client only.",
  },
  {
    value: "all",
    label: "All event contacts",
    hint: "Every client linked to the event.",
  },
  {
    value: "primary",
    label: "Primary client only",
    hint: "Only the primary client (events.client_id / is_primary).",
  },
  {
    value: "contract_holder",
    label: "Contract holder only",
    hint: "Only the contact marked as contract holder.",
  },
  {
    value: "roles",
    label: "Specific roles",
    hint: "Pick by role: primary, contract holder, planner, bride, etc.",
  },
];

export const RECIPIENT_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "primary", label: "Primary client" },
  { value: "contract_holder", label: "Contract holder" },
  { value: "all_clients", label: "All clients" },
  { value: "planner", label: "Planner" },
  { value: "bride", label: "Bride" },
  { value: "groom", label: "Groom" },
  { value: "client", label: "Client (role label)" },
];

export function parseRecipientConfig(raw: unknown): HelperRecipientConfig {
  if (!raw || typeof raw !== "object") return { mode: "default" };
  const obj = raw as Record<string, unknown>;
  const mode = typeof obj.mode === "string" ? obj.mode : "default";
  const allowed: RecipientMode[] = ["default", "all", "primary", "contract_holder", "roles"];
  const safeMode = (allowed.includes(mode as RecipientMode) ? mode : "default") as RecipientMode;
  const roles = Array.isArray(obj.roles)
    ? obj.roles.map((r) => String(r).trim()).filter(Boolean)
    : undefined;
  return roles?.length ? { mode: safeMode, roles } : { mode: safeMode };
}

export function recipientConfigNeedsMigration(cfg: HelperRecipientConfig | null | undefined): boolean {
  if (!cfg) return false;
  return cfg.mode !== "default";
}

export function actionNeedsRecipientMigration(action: {
  type?: string;
  to?: string;
  recipients?: unknown;
}): boolean {
  if (action.type !== "send_email" && action.type !== "send_sms") return false;
  if (action.to === "custom") return false;
  return recipientConfigNeedsMigration(parseRecipientConfig(action.recipients));
}

function displayName(c: EventContact): string {
  const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  return name || "Unnamed contact";
}

function normRole(role: string | null | undefined): string {
  return (role ?? "").trim().toLowerCase();
}

function matchesRoleKey(contact: EventContact, key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return false;
  if (k === "primary") return contact.isPrimary;
  if (k === "contract_holder" || k === "contract holder") return contact.isContractHolder;
  if (k === "all_clients" || k === "all") return true;
  // Free-text / common labels on event_clients.role
  return normRole(contact.role) === k;
}

/** Pick contacts for a template-level recipient config (no per-run override yet). */
export function selectContactsForConfig(
  contacts: EventContact[],
  cfg: HelperRecipientConfig,
): ResolvedRecipient[] {
  const mode = cfg.mode ?? "default";
  const out: ResolvedRecipient[] = [];
  const seen = new Set<string>();

  const add = (c: EventContact, matchedBy: string) => {
    if (seen.has(c.clientId)) {
      const existing = out.find((r) => r.clientId === c.clientId);
      if (existing && !existing.matchedBy.includes(matchedBy)) existing.matchedBy.push(matchedBy);
      return;
    }
    seen.add(c.clientId);
    out.push({ ...c, matchedBy: [matchedBy] });
  };

  if (mode === "default" || mode === "primary") {
    const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
    if (primary) add(primary, mode === "default" ? "default (primary)" : "primary");
    return out;
  }

  if (mode === "all") {
    for (const c of contacts) add(c, "all contacts");
    return out;
  }

  if (mode === "contract_holder") {
    const holders = contacts.filter((c) => c.isContractHolder);
    for (const c of holders) add(c, "contract holder");
    // No silent fallback to primary: empty set is intentional so the UI can warn.
    return out;
  }

  // mode === "roles"
  const roles = cfg.roles?.length ? cfg.roles : ["primary"];
  for (const role of roles) {
    for (const c of contacts) {
      if (matchesRoleKey(c, role)) add(c, role);
    }
  }
  return out;
}

/**
 * Apply an optional per-run override (exact client ids staff checked).
 * Unknown ids are ignored. Empty override list means "send to nobody"
 * (operator unchecked everyone) — distinct from "no override".
 */
export function applyRecipientOverride(
  contacts: EventContact[],
  base: ResolvedRecipient[],
  overrideClientIds: string[] | null | undefined,
): ResolvedRecipient[] {
  if (overrideClientIds == null) return base;
  const wanted = new Set(overrideClientIds);
  const byId = new Map(contacts.map((c) => [c.clientId, c]));
  const out: ResolvedRecipient[] = [];
  const seen = new Set<string>();
  for (const id of overrideClientIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = byId.get(id);
    if (!c) continue;
    const fromBase = base.find((b) => b.clientId === id);
    out.push({
      ...c,
      matchedBy: fromBase?.matchedBy?.length ? [...fromBase.matchedBy, "staff override"] : ["staff override"],
    });
  }
  // Preserve stable order: follow override list order, not contact table order.
  void wanted;
  return out;
}

export function splitByChannel(
  selected: ResolvedRecipient[],
  channel: RecipientChannel,
): RecipientResolution {
  const ready: ResolvedRecipient[] = [];
  const missing: ResolvedRecipient[] = [];
  const warnings: string[] = [];

  for (const r of selected) {
    const value = channel === "email" ? (r.email ?? "").trim() : (r.phone ?? "").trim();
    if (value) ready.push(r);
    else {
      missing.push(r);
      const what = channel === "email" ? "email" : "phone number";
      warnings.push(`${displayName(r)} has no ${what} on file — skipped.`);
    }
  }

  if (selected.length === 0) {
    warnings.push(
      channel === "email"
        ? "No contacts matched this email step's recipient setting."
        : "No contacts matched this text step's recipient setting.",
    );
  }

  return { selected: ready, missingChannel: missing, warnings };
}

/** Full resolve: config → optional override → channel split. */
export function resolveHelperRecipients(input: {
  contacts: EventContact[];
  config?: HelperRecipientConfig | null;
  /** null/undefined = use config; array (even empty) = staff override. */
  overrideClientIds?: string[] | null;
  channel: RecipientChannel;
}): RecipientResolution {
  const cfg = input.config ?? { mode: "default" };
  const base = selectContactsForConfig(input.contacts, cfg);
  const selected = applyRecipientOverride(input.contacts, base, input.overrideClientIds);
  return splitByChannel(selected, input.channel);
}

/** Dedupe by client id while keeping first occurrence (for multi-step previews). */
export function uniqueContacts(contacts: EventContact[]): EventContact[] {
  const seen = new Set<string>();
  const out: EventContact[] = [];
  for (const c of contacts) {
    if (seen.has(c.clientId)) continue;
    seen.add(c.clientId);
    out.push(c);
  }
  return out;
}

export function contactLabel(c: Pick<EventContact, "firstName" | "lastName" | "role" | "isPrimary" | "isContractHolder">): string {
  const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed contact";
  const badges: string[] = [];
  if (c.isPrimary) badges.push("primary");
  if (c.isContractHolder) badges.push("contract holder");
  if (c.role && !badges.includes(normRole(c.role))) badges.push(c.role);
  return badges.length ? `${name} (${badges.join(", ")})` : name;
}

export function summarizeRecipientConfig(cfg: HelperRecipientConfig | null | undefined): string {
  const c = cfg ?? { mode: "default" };
  switch (c.mode) {
    case "all":
      return "all event contacts";
    case "primary":
      return "primary client";
    case "contract_holder":
      return "contract holder";
    case "roles":
      return c.roles?.length ? `roles: ${c.roles.join(", ")}` : "selected roles";
    default:
      return "primary client (default)";
  }
}
