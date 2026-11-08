"use server";

import { revalidatePath } from "next/cache";
import { getMe, requireMaster } from "@/lib/auth";
import { generateServiceToken } from "@/lib/mcp/crypto";
import { assertScopes } from "@/lib/mcp/scopes";
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
  if (error) return { error: "Could not save the token. Apply migration 00217 first." };
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
    .select("id, name, scopes, note")
    .eq("id", id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!old) return { error: "That token is not active." };
  const minted = generateServiceToken();
  const me = await getMe();
  const { error } = await admin.from("mcp_service_tokens").insert({
    name: old.name,
    token_prefix: minted.prefix,
    token_hash: minted.hash,
    scopes: old.scopes,
    rotated_from_id: old.id,
    note: old.note,
    created_by: me?.userId ?? null,
  });
  if (error) return { error: "Could not rotate the token." };
  await admin.from("mcp_service_tokens").update({ overlap_until: new Date(Date.now() + hours * 3_600_000).toISOString() }).eq("id", old.id);
  revalidatePath("/settings/mcp");
  return { token: minted.raw, prefix: minted.prefix, name: old.name as string };
}

export async function revokeMcpToken(formData: FormData) {
  await requireMaster();
  const id = String(formData.get("token_id") ?? "");
  const now = new Date().toISOString();
  await createAdminClient().from("mcp_service_tokens").update({ revoked_at: now, overlap_until: now }).eq("id", id);
  revalidatePath("/settings/mcp");
}
