import {
  accessAtLeast,
  DEFAULT_ROLE_PERMISSIONS,
  type Access,
  type Role,
} from "@/lib/permissions";
import { MCP_SCOPES, type McpScope } from "../scopes";

/**
 * Map an XOS permission grid to MCP scopes.
 * View → read.*; edit → write.* (and money / comms / helpers where the module implies it).
 * Master admin passes an all-edit map from resolveAccessMap and gets the full closed list.
 */
export function mcpScopesFromAccess(can: Record<string, Access>): McpScope[] {
  const selected = new Set<McpScope>();
  const add = (scope: McpScope) => selected.add(scope);
  const level = (module: string): Access => can[module] ?? "none";

  const pair = (module: string, read: McpScope, write: McpScope) => {
    const access = level(module);
    if (accessAtLeast(access, "view")) add(read);
    if (accessAtLeast(access, "edit")) add(write);
  };

  pair("events", "read.events", "write.events");
  pair("clients", "read.clients", "write.clients");
  pair("venues", "read.venues", "write.venues");
  pair("vendors", "read.vendors", "write.vendors");
  pair("employees", "read.staff", "write.staff");
  pair("packages", "read.catalog", "write.catalog");
  pair("equipment", "read.equipment", "write.equipment");
  pair("documents", "read.documents", "write.documents");
  pair("settings", "read.settings", "write.settings");

  if (accessAtLeast(level("inbox"), "view")) add("read.inbox");
  if (accessAtLeast(level("reports"), "view")) add("read.reports");

  // Planning lives on the event; mirror events access.
  if (accessAtLeast(level("events"), "view")) add("read.planning");
  if (accessAtLeast(level("events"), "edit")) add("write.planning");

  if (accessAtLeast(level("payments"), "view")) add("money");
  if (accessAtLeast(level("payroll"), "view")) add("money.payroll");

  if (accessAtLeast(level("events"), "edit") || accessAtLeast(level("clients"), "edit")) {
    add("delete");
    add("comms.email");
    add("comms.sms");
    add("comms.contract");
    add("helpers.run");
  }
  if (accessAtLeast(level("settings"), "edit")) add("comms.webhook");

  return MCP_SCOPES.filter((scope) => selected.has(scope));
}

/** Convenience for tests / callers that only have a role tier (role defaults, no overrides). */
export function mcpScopesForRole(role: Role, can?: Record<string, Access>): McpScope[] {
  if (can) return mcpScopesFromAccess(can);
  if (role === "master_admin") return [...MCP_SCOPES];
  return mcpScopesFromAccess(DEFAULT_ROLE_PERMISSIONS[role] ?? {});
}

export function oauthConnectionName(personLabel: string): string {
  const base = personLabel.trim() || "Staff";
  return `${base.slice(0, 70)} (OAuth)`.slice(0, 80);
}
