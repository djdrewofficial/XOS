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

const SCOPE_SET = new Set<string>(MCP_SCOPES);

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
