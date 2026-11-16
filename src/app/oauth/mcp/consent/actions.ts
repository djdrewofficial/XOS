"use server";

import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { approveConsent, canApproveOAuth, denyConsent } from "@/lib/mcp/oauth/server";
import { supabaseOAuthStore } from "@/lib/mcp/oauth/supabaseOAuthStore";
import { assertScopes } from "@/lib/mcp/scopes";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireApprover() {
  const me = await getMe();
  if (!me || me.accountType !== "staff" || !me.userId) {
    throw new Error("Sign in to approve this connection.");
  }
  const roles = await supabaseOAuthStore(createAdminClient()).getApproverRoles();
  if (!canApproveOAuth(me.role, roles)) {
    throw new Error("Your role is not allowed to approve MCP connections.");
  }
  return me;
}

export async function approveMcpOAuthConsent(formData: FormData) {
  const me = await requireApprover();
  const pendingId = String(formData.get("request_id") ?? "").trim();
  const connectionName = String(formData.get("connection_name") ?? "").trim();
  let scopes;
  try {
    scopes = assertScopes(formData.getAll("scope").map(String));
  } catch {
    throw new Error("Those scopes are not valid.");
  }
  const result = await approveConsent(supabaseOAuthStore(createAdminClient()), {
    pendingId,
    connectionName,
    scopes,
    approvedBy: me.userId,
    now: new Date(),
  });
  if (!result.ok) throw new Error(result.body.error_description || result.body.error);
  redirect(result.value.redirectTo);
}

export async function denyMcpOAuthConsent(formData: FormData) {
  await requireApprover();
  const pendingId = String(formData.get("request_id") ?? "").trim();
  const result = await denyConsent(supabaseOAuthStore(createAdminClient()), pendingId, new Date());
  if (!result.ok) throw new Error(result.body.error_description || result.body.error);
  redirect(result.value.redirectTo);
}
