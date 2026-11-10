"use server";

import { revalidatePath } from "next/cache";
import { getMe, requireMaster } from "@/lib/auth";
import { tokenDecision } from "@/lib/mcp/auth";
import { generateServiceToken } from "@/lib/mcp/crypto";
import { executeHumanApproved } from "@/lib/mcp/protocol";
import { secretValuesFromEnv } from "@/lib/mcp/redact";
import { assertScopes } from "@/lib/mcp/scopes";
import { supabaseStore } from "@/lib/mcp/supabaseStore";
import { mcpTools } from "@/lib/mcp/tools";
import { createAdminClient } from "@/lib/supabase/admin";

export type TokenFlash = { token: string; prefix: string; name: string } | { error: string } | null;

function fail(error: unknown, fallback: string): TokenFlash {
  return { error: error instanceof Error ? error.message : fallback };
}

/** Mint a service token. The raw value is returned once and is not logged. */
export async function mintMcpToken(_prev: TokenFlash, formData: FormData): Promise<TokenFlash> {
  await requireMaster();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the token a name." };
  let scopes;
  try {
    scopes = assertScopes(formData.getAll("scope").map(String));
  } catch (error) {
    return fail(error, "Those scopes are not valid.");
  }
  if (!scopes.length) return { error: "Pick at least one scope. A token with no scopes can only see who it is." };
  const days = Number(formData.get("expires_days") || 0);
  const expires = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  const minted = generateServiceToken();
  const me = await getMe();
  const { error } = await createAdminClient().from("mcp_service_tokens").insert({
    name,
    token_prefix: minted.prefix,
    token_hash: minted.hash,
    scopes,
    expires_at: expires,
    created_by: me?.userId ?? null,
    note: String(formData.get("note") ?? "").trim() || null,
  });
  if (error) return { error: "Could not save the token. Apply migration 00219 first." };
  revalidatePath("/settings/mcp");
  return { token: minted.raw, prefix: minted.prefix, name };
}

/** Issue a new token with the same scopes. The old one keeps working until the overlap ends. */
export async function rotateMcpToken(_prev: TokenFlash, formData: FormData): Promise<TokenFlash> {
  await requireMaster();
  const id = String(formData.get("token_id") ?? "");
  const hours = Math.max(0, Math.min(24 * 14, Number(formData.get("overlap_hours") ?? 24) || 0));
  const admin = createAdminClient();
  const { data: old } = await admin
    .from("mcp_service_tokens")
    .select("id, name, scopes, note, expires_at")
    .eq("id", id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!old) return { error: "That token is not active." };
  const minted = generateServiceToken();
  const me = await getMe();
  const { data: created, error } = await admin.from("mcp_service_tokens").insert({
    name: old.name,
    token_prefix: minted.prefix,
    token_hash: minted.hash,
    scopes: old.scopes,
    expires_at: old.expires_at,
    rotated_from_id: old.id,
    note: old.note,
    created_by: me?.userId ?? null,
  }).select("id").single();
  if (error || !created) return { error: "Could not rotate the token." };
  const { error: overlapError } = await admin
    .from("mcp_service_tokens")
    .update({ overlap_until: new Date(Date.now() + hours * 3_600_000).toISOString() })
    .eq("id", old.id);
  if (overlapError) {
    const { error: revokeError } = await admin.from("mcp_service_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", created.id);
    if (revokeError) {
      throw new Error("Rotation failed and the new token could not be revoked. Revoke that token before using either one.");
    }
    return { error: "Rotation did not finish. The new token was revoked and the old token is unchanged." };
  }
  revalidatePath("/settings/mcp");
  return { token: minted.raw, prefix: minted.prefix, name: old.name as string };
}

/** The only path that runs a sensitive preview. Requires the signed-in master admin, not an agent token. */
export async function approveMcpPreview(formData: FormData) {
  await requireMaster();
  const me = await getMe();
  if (!me?.userId) throw new Error("Not signed in.");
  const id = String(formData.get("confirmation_id") ?? "");
  const admin = createAdminClient();
  const { data: row, error } = await admin.from("mcp_confirmations").select("token_id").eq("id", id).maybeSingle();
  if (error || !row) throw new Error("That preview is not available. Apply migration 00220 before approving.");
  const { data: token, error: tokenError } = await admin
    .from("mcp_service_tokens")
    .select("id, name, scopes, revoked_at, expires_at, overlap_until")
    .eq("id", row.token_id)
    .maybeSingle();
  if (tokenError || !token) throw new Error("The agent token is not active.");
  const decision = tokenDecision({
    revoked_at: token.revoked_at as string | null,
    expires_at: token.expires_at as string | null,
    overlap_until: token.overlap_until as string | null,
  }, new Date());
  if (!decision.ok) throw new Error(`The agent token is not active (${decision.reason}).`);
  await executeHumanApproved(supabaseStore(admin), mcpTools, {
    confirmationId: id,
    userId: me.userId,
    token: {
      id: token.id as string,
      name: token.name as string,
      scopes: (token.scopes as string[]) ?? [],
      revoked_at: token.revoked_at as string | null,
      expires_at: token.expires_at as string | null,
      overlap_until: token.overlap_until as string | null,
    },
    now: new Date(),
    admin,
    secrets: secretValuesFromEnv(process.env),
  });
  revalidatePath("/settings/mcp");
}

export async function rejectMcpPreview(formData: FormData) {
  await requireMaster();
  const me = await getMe();
  if (!me?.userId) throw new Error("Not signed in.");
  const id = String(formData.get("confirmation_id") ?? "");
  const decided = await supabaseStore(createAdminClient()).decideConfirmation(id, {
    userId: me.userId,
    now: new Date(),
    kind: "reject",
  });
  if (!decided) throw new Error("That preview can no longer be rejected.");
  revalidatePath("/settings/mcp");
}

export async function revokeMcpToken(formData: FormData) {
  await requireMaster();
  const id = String(formData.get("token_id") ?? "");
  const now = new Date().toISOString();
  const { error } = await createAdminClient().from("mcp_service_tokens").update({ revoked_at: now, overlap_until: now }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/mcp");
}
