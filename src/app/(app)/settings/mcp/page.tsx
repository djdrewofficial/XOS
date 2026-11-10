import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { formatMcpScopeLabels } from "@/lib/mcp/scopes";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApprovalCard, MintForm, RevokeButton, RotateForm } from "./McpAdmin";

export const dynamic = "force-dynamic";

type TokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  overlap_until: string | null;
};

export default async function McpSettingsPage() {
  const me = await getMe();
  if (!me || me.role !== "master_admin") redirect("/no-access");

  let tokens: TokenRow[] = [];
  let setupNeeded = false;
  try {
    const { data, error } = await createAdminClient()
      .from("mcp_service_tokens")
      .select("id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at, overlap_until")
      .order("created_at", { ascending: false });
    if (error) setupNeeded = true;
    else tokens = (data ?? []) as TokenRow[];
  } catch {
    setupNeeded = true;
  }

  const active = tokens.filter((token) => !token.revoked_at);
  let pending: { id: string; tool_name: string; preview: unknown }[] = [];
  let approvalReady = !setupNeeded;
  if (!setupNeeded) {
    const { data, error } = await createAdminClient()
      .from("mcp_confirmations")
      .select("id, tool_name, preview, expires_at, used_at, rejected_at")
      .is("used_at", null)
      .is("rejected_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) approvalReady = false;
    else pending = (data ?? []) as { id: string; tool_name: string; preview: unknown }[];
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="page-title mb-1">Agent Access</h1>
        <p className="text-sm text-zinc-500">
          Service tokens for Grok Bot and other agents. They are not staff logins. The secret is shown once, stored only as a hash, and never written to the audit log.
        </p>
      </div>

      {setupNeeded ? (
        <div className="card p-5">
          <h2 className="card-title">One-time setup needed</h2>
          <p className="text-sm text-zinc-600">
            Apply <code>supabase/migrations/00219_mcp_service_access.sql</code> before creating tokens. This page does not apply it.
          </p>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="table-head text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Prefix</th>
                  <th className="px-3 py-2">Scopes</th>
                  <th className="px-3 py-2">Last used</th>
                  <th className="px-3 py-2">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id} className="border-t border-zinc-200">
                    <td className="px-3 py-2">{token.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{token.token_prefix}…</td>
                    <td className="px-3 py-2 text-xs">{formatMcpScopeLabels(token.scopes ?? [])}</td>
                    <td className="px-3 py-2">{token.last_used_at ? new Date(token.last_used_at).toLocaleString() : "Never"}</td>
                    <td className="px-3 py-2">{statusLabel(token)}</td>
                    <td className="px-3 py-2">{token.revoked_at ? null : <RevokeButton id={token.id} />}</td>
                  </tr>
                ))}
                {tokens.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-4 text-zinc-500">No tokens yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {approvalReady ? pending.map((item) => {
            const preview = item.preview as { receipt?: unknown; effect_snapshot?: unknown; effect_hash?: string } | null;
            return (
              <ApprovalCard
                key={item.id}
                id={item.id}
                tool={item.tool_name}
                receipt={JSON.stringify(preview?.effect_snapshot ?? preview?.receipt ?? item.preview, null, 2)}
              />
            );
          }) : (
            <div className="card p-5 text-sm">
              Approvals need migration 00220 in the migration history. Until then, sensitive previews cannot be run.
            </div>
          )}
          <MintForm />
          <RotateForm tokens={active.map((token) => ({ id: token.id, name: token.name, token_prefix: token.token_prefix }))} />
        </>
      )}
    </div>
  );
}

function statusLabel(token: TokenRow) {
  if (token.revoked_at) return "Revoked";
  if (token.expires_at && Date.parse(token.expires_at) <= Date.now()) return "Expired";
  if (token.overlap_until) return `Rotating until ${new Date(token.overlap_until).toLocaleString()}`;
  return "Active";
}
