import type { SupabaseClient } from "@supabase/supabase-js";
import type { JsonSchema } from "./validate";

export type ToolContext = {
  now: Date;
  token: { id: string; name: string; scopes: readonly string[] };
  /** Service-role client. Present when the server is handling a live request. */
  admin: SupabaseClient;
};

export type ToolHandler = {
  preview?(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
  /** Snapshot of mutable templates, helpers, recipients, and bodies. Re-checked at human approval. */
  freeze?(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
  /** Extra scope check once arguments are known (a helper that texts needs comms.sms). */
  authorize?(args: Record<string, unknown>, ctx: ToolContext): Promise<void>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
};

export type ToolSpec = {
  name: string;
  description: string;
  scopes: readonly string[];
  confirm: boolean;
  /** Mutating tools require an idempotency key. Confirm implies a write. */
  writes?: boolean;
  inputSchema: JsonSchema;
};

export class McpAuthError extends Error {
  reason: "missing" | "invalid" | "revoked" | "expired" | "overlap_ended";
  constructor(message: string, reason: "missing" | "invalid" | "revoked" | "expired" | "overlap_ended") {
    super(message);
    this.name = "McpAuthError";
    this.reason = reason;
  }
}

export class McpScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpScopeError";
  }
}
