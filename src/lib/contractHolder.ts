/**
 * Partner 1 / contract-holder resolution for proposal pages, Booking Agreement
 * merge tags, and document "prepared for" / signature name lines.
 *
 * Rule: prefer event_clients.is_contract_holder. If several holders, prefer one
 * whose role is not Planner, then is_primary, then oldest (created_at). Fall
 * back to events.client_id only when no holder exists.
 */

export type ContractHolderMember = {
  clientId: string;
  eventClientId?: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
  mailingAddress?: string | null;
  authorizedRepName?: string | null;
  authorizedRepTitle?: string | null;
  authorizedRepEmail?: string | null;
  authorizedRepPhone?: string | null;
  role: string | null;
  isPrimary: boolean;
  isContractHolder: boolean;
  createdAt: string | null;
};

export type PickContractHolderInput = {
  members: ContractHolderMember[];
  /** events.client_id — used only when no holder is flagged. */
  eventClientId: string | null;
};

function isPlannerRole(role: string | null | undefined): boolean {
  return (role ?? "").trim().toLowerCase() === "planner";
}

function rankHolder(a: ContractHolderMember, b: ContractHolderMember): number {
  // Prefer non-planner
  const aPlan = isPlannerRole(a.role) ? 1 : 0;
  const bPlan = isPlannerRole(b.role) ? 1 : 0;
  if (aPlan !== bPlan) return aPlan - bPlan;
  // Then primary
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  // Then oldest created_at
  const aT = a.createdAt ?? "";
  const bT = b.createdAt ?? "";
  if (aT && bT && aT !== bT) return aT < bT ? -1 : 1;
  if (aT && !bT) return -1;
  if (!aT && bT) return 1;
  return 0;
}

/** Partner 1: contract holder, or events.client_id fallback, or first member. */
export function pickContractHolder(input: PickContractHolderInput): ContractHolderMember | null {
  const holders = input.members.filter((m) => m.isContractHolder);
  if (holders.length === 1) return holders[0];
  if (holders.length > 1) {
    return [...holders].sort(rankHolder)[0] ?? null;
  }

  if (input.eventClientId) {
    const byEvent = input.members.find((m) => m.clientId === input.eventClientId);
    if (byEvent) return byEvent;
  }

  const primary = input.members.find((m) => m.isPrimary);
  return primary ?? input.members[0] ?? null;
}

/** Partner 2 for the proposal form: first non-holder who is not a Planner. */
export function pickPartnerB(
  members: ContractHolderMember[],
  holder: ContractHolderMember | null,
): ContractHolderMember | null {
  const holderId = holder?.clientId ?? null;
  const candidates = members.filter(
    (m) => m.clientId !== holderId && !isPlannerRole(m.role),
  );
  if (candidates.length === 0) return null;
  // Prefer primary among remaining, else oldest
  return [...candidates].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const aT = a.createdAt ?? "";
    const bT = b.createdAt ?? "";
    if (aT && bT && aT !== bT) return aT < bT ? -1 : 1;
    return 0;
  })[0];
}

/** Contacts with role Planner (for the proposal "Planner" block). */
export function pickPlanners(
  members: ContractHolderMember[],
  holder: ContractHolderMember | null,
): ContractHolderMember[] {
  const holderId = holder?.clientId ?? null;
  return members.filter((m) => isPlannerRole(m.role) && m.clientId !== holderId);
}

export function displayName(m: Pick<ContractHolderMember, "firstName" | "lastName">): string {
  return `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim();
}

/** Client-facing merge tags that must name the contract holder (Partner 1). */
export const CONTRACT_HOLDER_MERGE_TAGS = [
  "first_name",
  "last_name",
  "client_name",
  "client_email",
  "client_cell",
  "client_organization",
  "client_address",
  "authorized_rep_name",
  "authorized_rep_title",
  "authorized_rep_email",
  "authorized_rep_phone",
] as const;

export type ContractHolderMergeTag = (typeof CONTRACT_HOLDER_MERGE_TAGS)[number];

function escHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * After SQL render_merge_tags (which may still use events.client_id until
 * migration 00239), re-apply contract-holder values for the client name tags.
 * Safe to call even after 00239 (idempotent when values already match).
 */
export function applyContractHolderMergeTags(
  html: string,
  holder: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    organization: string | null;
    mailingAddress?: string | null;
    authorizedRepName?: string | null;
    authorizedRepTitle?: string | null;
    authorizedRepEmail?: string | null;
    authorizedRepPhone?: string | null;
  } | null,
): string {
  if (!holder || !html) return html;
  const full = `${holder.firstName ?? ""} ${holder.lastName ?? ""}`.trim();
  const map: Record<string, string> = {
    first_name: escHtml(holder.firstName),
    last_name: escHtml(holder.lastName),
    client_name: escHtml(full),
    client_email: escHtml(holder.email),
    client_cell: escHtml(holder.phone),
    client_organization: escHtml(holder.organization),
    client_address: escHtml(holder.mailingAddress ?? null),
    authorized_rep_name: escHtml(holder.authorizedRepName ?? null),
    authorized_rep_title: escHtml(holder.authorizedRepTitle ?? null),
    authorized_rep_email: escHtml(holder.authorizedRepEmail ?? null),
    authorized_rep_phone: escHtml(holder.authorizedRepPhone ?? null),
  };
  let out = html;
  for (const [tag, value] of Object.entries(map)) {
    // Only replace unresolved tags (still present as <tag>). Values already
    // substituted by SQL stay as-is unless the tag somehow remains.
    out = out.split(`<${tag}>`).join(value);
  }
  return out;
}
