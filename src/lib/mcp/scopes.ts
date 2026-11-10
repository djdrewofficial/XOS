/** Closed scope list for MCP service tokens. Deny by default: a token can call
    a tool only when it holds every scope that tool requires. */

export const MCP_SCOPES = [
  "read.events",
  "write.events",
  "read.clients",
  "write.clients",
  "read.venues",
  "write.venues",
  "read.vendors",
  "write.vendors",
  "read.staff",
  "write.staff",
  "read.catalog",
  "write.catalog",
  "read.equipment",
  "write.equipment",
  "read.documents",
  "write.documents",
  "read.planning",
  "write.planning",
  "read.inbox",
  "read.reports",
  "read.settings",
  "write.settings",
  "money",
  "money.payroll",
  "delete",
  "comms.email",
  "comms.sms",
  "comms.contract",
  "comms.webhook",
  "helpers.run",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/** Friendly labels for the Agent Access UI. Keys must match MCP_SCOPES exactly.
    Internal IDs stay dotted; never change those values. Client wording uses
    "booking agreement", never "contract" or "invoice". */
export const MCP_SCOPE_LABELS = {
  "read.events": "View events",
  "write.events": "Edit events",
  "read.clients": "View clients",
  "write.clients": "Edit clients",
  "read.venues": "View venues",
  "write.venues": "Edit venues",
  "read.vendors": "View vendors",
  "write.vendors": "Edit vendors",
  "read.staff": "View staff",
  "write.staff": "Edit staff",
  "read.catalog": "View catalog",
  "write.catalog": "Edit catalog",
  "read.equipment": "View equipment",
  "write.equipment": "Edit equipment",
  "read.documents": "View documents",
  "write.documents": "Edit documents",
  "read.planning": "View planning",
  "write.planning": "Edit planning",
  "read.inbox": "View inbox",
  "read.reports": "View reports",
  "read.settings": "View settings",
  "write.settings": "Edit settings",
  money: "Payments",
  "money.payroll": "Payroll",
  delete: "Delete records",
  "comms.email": "Send emails",
  "comms.sms": "Send texts",
  "comms.contract": "Send booking agreements",
  "comms.webhook": "Trigger webhooks",
  "helpers.run": "Run helpers",
} as const satisfies Record<McpScope, string>;

export type McpScopeGroup = {
  title: string;
  /** Paired View / Edit scopes when both exist. */
  view?: McpScope;
  edit?: McpScope;
  /** Standalone scopes in this group (no View/Edit pair). */
  scopes?: McpScope[];
};

/** Checkbox layout for the mint form. Every MCP_SCOPES entry appears once. */
export const MCP_SCOPE_GROUPS: readonly McpScopeGroup[] = [
  { title: "Events", view: "read.events", edit: "write.events" },
  { title: "Clients", view: "read.clients", edit: "write.clients" },
  { title: "Venues", view: "read.venues", edit: "write.venues" },
  { title: "Vendors", view: "read.vendors", edit: "write.vendors" },
  { title: "Staff", view: "read.staff", edit: "write.staff" },
  { title: "Catalog", view: "read.catalog", edit: "write.catalog" },
  { title: "Equipment", view: "read.equipment", edit: "write.equipment" },
  { title: "Documents", view: "read.documents", edit: "write.documents" },
  { title: "Planning", view: "read.planning", edit: "write.planning" },
  { title: "Inbox / Reports", scopes: ["read.inbox", "read.reports"] },
  { title: "Settings", view: "read.settings", edit: "write.settings" },
  { title: "Money", scopes: ["money", "money.payroll"] },
  { title: "Communications", scopes: ["comms.email", "comms.sms", "comms.contract", "comms.webhook"] },
  { title: "Danger: Delete", scopes: ["delete"] },
  { title: "Helpers", scopes: ["helpers.run"] },
];

const SCOPE_SET = new Set<string>(MCP_SCOPES);

export function mcpScopeLabel(scope: string): string {
  return isMcpScope(scope) ? MCP_SCOPE_LABELS[scope] : scope;
}

/** Friendly labels for a token's scope list, in MCP_SCOPES order. */
export function formatMcpScopeLabels(scopes: readonly string[]): string {
  const known = MCP_SCOPES.filter((scope) => scopes.includes(scope)).map((scope) => MCP_SCOPE_LABELS[scope]);
  const unknown = scopes.filter((scope) => !isMcpScope(scope));
  return [...known, ...unknown].join(", ") || "—";
}

/** Every scope in the closed list. Used by the mint form's "Select all". */
export function allMcpScopes(scopes: readonly McpScope[] = MCP_SCOPES): McpScope[] {
  return [...scopes];
}

/** Scopes that start with `read.`, including read.reports. */
export function readMcpScopes(scopes: readonly McpScope[] = MCP_SCOPES): McpScope[] {
  return scopes.filter((scope) => scope.startsWith("read."));
}

/** delete, money, money.payroll, and any comms.* scope. */
export function isHighRiskMcpScope(scope: string): boolean {
  return scope === "delete" || scope === "money" || scope === "money.payroll" || scope.startsWith("comms.");
}

export function hasHighRiskMcpScope(selected: readonly string[]): boolean {
  return selected.some(isHighRiskMcpScope);
}

/** Toggle one scope in a checked set. Returns a new array in MCP_SCOPES order. */
export function toggleMcpScope(selected: readonly string[], scope: McpScope, on: boolean): McpScope[] {
  const next = new Set(selected.filter(isMcpScope));
  if (on) next.add(scope);
  else next.delete(scope);
  return MCP_SCOPES.filter((item) => next.has(item));
}

/** True when every closed-list scope has exactly one label and group entry. */
export function mcpScopeUiComplete(): { ok: true } | { ok: false; missingLabels: string[]; extraLabels: string[]; missingGroups: string[]; duplicateGroups: string[] } {
  const labelKeys = Object.keys(MCP_SCOPE_LABELS);
  const missingLabels = MCP_SCOPES.filter((scope) => !(scope in MCP_SCOPE_LABELS));
  const extraLabels = labelKeys.filter((key) => !SCOPE_SET.has(key));
  const grouped: McpScope[] = [];
  for (const group of MCP_SCOPE_GROUPS) {
    if (group.view) grouped.push(group.view);
    if (group.edit) grouped.push(group.edit);
    for (const scope of group.scopes ?? []) grouped.push(scope);
  }
  const missingGroups = MCP_SCOPES.filter((scope) => !grouped.includes(scope));
  const seen = new Set<string>();
  const duplicateGroups: string[] = [];
  for (const scope of grouped) {
    if (seen.has(scope)) duplicateGroups.push(scope);
    seen.add(scope);
  }
  if (missingLabels.length || extraLabels.length || missingGroups.length || duplicateGroups.length) {
    return { ok: false, missingLabels, extraLabels, missingGroups, duplicateGroups };
  }
  return { ok: true };
}

export function isMcpScope(value: string): value is McpScope {
  return SCOPE_SET.has(value);
}

export function assertScopes(values: readonly string[]): McpScope[] {
  const out: McpScope[] = [];
  for (const value of values) {
    if (!isMcpScope(value)) throw new Error(`Unknown scope: ${value}`);
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** Every required scope must be present. Empty required means the tool is
    available to any authenticated token (discovery and confirm). */
export function scopesAllow(granted: readonly string[], required: readonly string[]): boolean {
  return required.every((scope) => granted.includes(scope));
}

export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  return required.filter((scope) => !granted.includes(scope));
}
