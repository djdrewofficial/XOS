"use server";

import { revalidatePath } from "next/cache";
import { getMe, requireMaster } from "@/lib/auth";
import { tokenDecision } from "@/lib/mcp/auth";
import { generateServiceToken } from "@/lib/mcp/crypto";
import { executeHumanApproved } from "@/lib/mcp/protocol";
import { secretValuesFromEnv } from "@/lib/mcp/redact";
import { assertScopes } from "@/lib/mcp/scopes";
import { mintTokenFlash, rotateTokenFlash, type TokenFlash, type TokenFlashStore } from "@/lib/mcpTokenFlash";
import { supabaseStore } from "@/lib/mcp/supabaseStore";
import { mcpTools } from "@/lib/mcp/tools";
import { createAdminClient } from "@/lib/supabase/admin";

export type { TokenFlash };

function tokenStore(): TokenFlashStore {
  const admin = createAdminClient();
  return {
    async insert(row) {
      const { data, error } = await admin.from("mcp_service_tokens").insert(row).select("id").single();
      if (error || !data) return { error: "Could not save the token. Apply migration 00219 first." };
      return { id: data.id as string };
    },
    async setOverlap(id, overlapUntil) {
      const { error } = await admin.from("mcp_service_tokens").update({ overlap_until: overlapUntil }).eq("id", id);
      return { error: error?.message ?? null };
    },
    async revoke(id, at) {
      const { error } = await admin.from("mcp_service_tokens").update({ revoked_at: at, overlap_until: at }).eq("id", id);
      return { error: error?.message ?? null };
    },
  };
}

function fail(error: unknown, fallback: string): TokenFlash {
  return { error: error instanceof Error ? error.message : fallback };
}

/** Mint a service token. The raw value is returned once and is not logged.
    Do not revalidate the page before returning the secret — that remounts the
    form and drops useActionState, so Create stays on Creating… and the secret
    never appears even though the row was inserted. */
export async function mintMcpToken(_prev: TokenFlash, formData: FormData): Promise<TokenFlash> {
  try {
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
    return mintTokenFlash(tokenStore(), {
      name,
      scopes,
      expiresAt: expires,
      note: String(formData.get("note") ?? "").trim() || null,
      createdBy: me?.userId ?? null,
      minted,
    });
  } catch (error) {
    return fail(error, "Could not create the token.");
  }
}

/** Issue a new token with the same scopes. The old one keeps working until the overlap ends.
    Same rule as mint: return the secret before refreshing the page. */
export async function rotateMcpToken(_prev: TokenFlash, formData: FormData): Promise<TokenFlash> {
  try {
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
    return rotateTokenFlash(tokenStore(), {
      oldId: old.id as string,
      name: old.name as string,
      scopes: (old.scopes as string[]) ?? [],
      expiresAt: (old.expires_at as string | null) ?? null,
      note: (old.note as string | null) ?? null,
      createdBy: me?.userId ?? null,
      overlapUntil: new Date(Date.now() + hours * 3_600_000).toISOString(),
      minted,
    });
  } catch (error) {
    return fail(error, "Could not rotate the token.");
  }
}

/** Refresh the token list after the person has copied the one-time secret. */
export async function acknowledgeMcpTokenFlash(): Promise<void> {
  await requireMaster();
  revalidatePath("/settings/mcp");
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
