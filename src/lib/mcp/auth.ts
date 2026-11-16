export type ServiceTokenRow = {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  overlap_until: string | null;
  token_hash: string;
  /** When true, helpers_run skips the Agent Access receipt. Server-side only. */
  helpers_skip_xos_approval?: boolean;
  /** When true, most confirm tools skip the Agent Access receipt. Server-side only. */
  auto_approve?: boolean;
};

/**
 * Tools that permanently destroy or irreversibly alter data.
 * Trusted tokens still need a person to approve these in Agent Access.
 * Keep this list explicit; do not infer from caller arguments.
 */
export const ALWAYS_HUMAN_APPROVAL_TOOLS = [
  "clients_anonymize",
  "events_delete",
  "events_delete_note",
  "events_delete_expense",
  "events_delete_trip",
  "events_file_delete",
  "packages_delete_date_price",
  "venues_merge",
  "statuses_delete",
  "payment_reminders_delete",
  "documents_set_status",
  "assistant_article_status",
] as const;

const ALWAYS_HUMAN = new Set<string>(ALWAYS_HUMAN_APPROVAL_TOOLS);

/** helpers_run alone may skip the XOS receipt when the token record allows it. */
export function helpersRunSkipsXosApproval(
  toolName: string,
  token: Pick<ServiceTokenRow, "helpers_skip_xos_approval">,
): boolean {
  return toolName === "helpers_run" && token.helpers_skip_xos_approval === true;
}

/** True when this tool must keep the Agent Access receipt even for a trusted token. */
export function toolAlwaysNeedsHumanApproval(tool: {
  name: string;
  scopes?: readonly string[];
}): boolean {
  if (ALWAYS_HUMAN.has(tool.name)) return true;
  if ((tool.scopes ?? []).includes("delete")) return true;
  return false;
}

/**
 * Whether a confirm tool may execute without creating an mcp_confirmations receipt.
 * Read only from mcp_service_tokens (helpers_skip_xos_approval and/or auto_approve).
 * Never from client-supplied arguments.
 */
export function skipsXosApproval(
  tool: { name: string; confirm: boolean; scopes?: readonly string[] },
  token: Pick<ServiceTokenRow, "helpers_skip_xos_approval" | "auto_approve">,
): boolean {
  if (!tool.confirm) return false;
  if (toolAlwaysNeedsHumanApproval(tool)) return false;
  if (helpersRunSkipsXosApproval(tool.name, token)) return true;
  return token.auto_approve === true;
}

export type TokenDecision =
  | { ok: true }
  | { ok: false; reason: "revoked" | "expired" | "overlap_ended" };

/** A token works until it is revoked, past its expiry, or past the overlap
    window set when it was rotated. overlap_until null means it has not been rotated. */
export function tokenDecision(row: Pick<ServiceTokenRow, "revoked_at" | "expires_at" | "overlap_until">, now: Date): TokenDecision {
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) return { ok: false, reason: "expired" };
  if (row.overlap_until && Date.parse(row.overlap_until) <= now.getTime()) return { ok: false, reason: "overlap_ended" };
  return { ok: true };
}
