import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { formatMcpScopeLabels } from "@/lib/mcp/scopes";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ApprovalCard,
  HelpersSkipToggle,
  MintForm,
  RevokeButton,
  RotateForm,
  TrustedAgentToggle,
} from "./McpAdmin";

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
  helpers_skip_xos_approval?: boolean | null;
  auto_approve?: boolean | null;
};

type AuditRow = {
  id: number;
  created_at: string;
  token_name: string | null;
  tool_name: string | null;
  status: string;
  args_redacted: unknown;
  confirmation_id: string | null;
};

const TOKEN_COLS =
  "id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at, overlap_until";

export default async function McpSettingsPage() {
  const me = await getMe();
  if (!me || me.role !== "master_admin") redirect("/no-access");

  let tokens: TokenRow[] = [];
  let setupNeeded = false;
  let helpersSkipReady = false;
  let autoApproveReady = false;
  try {
    const admin = createAdminClient();
    const withBoth = await admin
      .from("mcp_service_tokens")
      .select(`${TOKEN_COLS}, helpers_skip_xos_approval, auto_approve`)
      .order("created_at", { ascending: false });
    if (!withBoth.error) {
      tokens = (withBoth.data ?? []) as TokenRow[];
      helpersSkipReady = true;
      autoApproveReady = true;
    } else {
      const withHelpers = await admin
        .from("mcp_service_tokens")
        .select(`${TOKEN_COLS}, helpers_skip_xos_approval`)
        .order("created_at", { ascending: false });
      if (!withHelpers.error) {
        tokens = (withHelpers.data ?? []) as TokenRow[];
        helpersSkipReady = true;
      } else {
        const fallback = await admin
          .from("mcp_service_tokens")
          .select(TOKEN_COLS)
          .order("created_at", { ascending: false });
        if (fallback.error) setupNeeded = true;
        else tokens = (fallback.data ?? []) as TokenRow[];
      }
    }
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

  let recentActivity: AuditRow[] = [];
  if (!setupNeeded) {
    const { data } = await createAdminClient()
      .from("mcp_audit_log")
      .select("id, created_at, token_name, tool_name, status, args_redacted, confirmation_id")
      .in("status", ["ok", "begun", "completed", "confirmation_required", "error", "failed"])
      .order("created_at", { ascending: false })
      .limit(40);
    recentActivity = ((data ?? []) as AuditRow[]).filter((row) => {
      if (!row.tool_name || row.tool_name === "initialize" || row.tool_name === "tools/list" || row.tool_name === "ping") {
        return false;
      }
      return ["ok", "begun", "completed", "confirmation_required", "error", "failed"].includes(row.status);
    }).slice(0, 25);
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
          {!helpersSkipReady ? (
            <div className="card p-4 text-sm text-zinc-600">
              Helper direct-run needs migration <code>00225_mcp_helpers_skip_xos_approval.sql</code> before the per-token toggle appears. This page does not apply it.
            </div>
          ) : null}
          {!autoApproveReady ? (
            <div className="card p-4 text-sm text-zinc-600">
              Trusted agent needs migration <code>00227_mcp_auto_approve.sql</code> before the per-token toggle appears. This page does not apply it.
            </div>
          ) : null}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="table-head text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Prefix</th>
                  <th className="px-3 py-2">Scopes</th>
                  <th className="px-3 py-2">Trust</th>
                  <th className="px-3 py-2">Helpers</th>
                  <th className="px-3 py-2">Last used</th>
                  <th className="px-3 py-2">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id} className="border-t border-zinc-200 align-top">
                    <td className="px-3 py-2">{token.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{token.token_prefix}…</td>
                    <td className="px-3 py-2 text-xs">{formatMcpScopeLabels(token.scopes ?? [])}</td>
                    <td className="px-3 py-2">
                      {!token.revoked_at && autoApproveReady ? (
                        <TrustedAgentToggle id={token.id} enabled={token.auto_approve === true} />
                      ) : token.auto_approve ? (
                        <span className="text-xs text-amber-800">Trusted</span>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!token.revoked_at && helpersSkipReady ? (
                        <HelpersSkipToggle id={token.id} enabled={token.helpers_skip_xos_approval === true} />
                      ) : token.helpers_skip_xos_approval ? (
                        <span className="text-xs text-amber-800">Skip XOS approval</span>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{token.last_used_at ? new Date(token.last_used_at).toLocaleString() : "Never"}</td>
                    <td className="px-3 py-2">{statusLabel(token)}</td>
                    <td className="px-3 py-2">{token.revoked_at ? null : <RevokeButton id={token.id} />}</td>
                  </tr>
                ))}
                {tokens.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-4 text-zinc-500">No tokens yet.</td></tr>
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
          {recentActivity.length > 0 ? (
            <div className="card overflow-hidden">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="card-title">Recent agent activity</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Includes Trusted-agent auto-runs and helpers that skipped a receipt. Args are redacted. Pending receipts above still need Approve and run.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="table-head text-left">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Tool</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((row) => (
                    <tr key={row.id} className="border-t border-zinc-200 align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs">{row.token_name ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.tool_name}</td>
                      <td className="px-3 py-2 text-xs">{activityStatus(row)}</td>
                      <td className="px-3 py-2 text-xs text-zinc-600">{activityNote(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
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

function activityStatus(row: AuditRow) {
  if (row.status === "ok" || row.status === "completed") return "Ran";
  if (row.status === "begun") return "Started";
  if (row.status === "confirmation_required") return "Waiting for you";
  if (row.status === "error" || row.status === "failed") return "Failed";
  return row.status;
}

function activityNote(row: AuditRow) {
  const args = row.args_redacted && typeof row.args_redacted === "object" && !Array.isArray(row.args_redacted)
    ? (row.args_redacted as Record<string, unknown>)
    : null;
  const bits: string[] = [];
  if (args?.auto_approve === true) bits.push("Trusted agent (auto-ran)");
  if (args?.helpers_skip_xos_approval === true) bits.push("Helpers skip");
  if (row.confirmation_id) bits.push(`Receipt ${row.confirmation_id.slice(0, 8)}…`);
  if (args?.receipt != null) bits.push("Effects logged");
  return bits.length ? bits.join(" · ") : "—";
}
