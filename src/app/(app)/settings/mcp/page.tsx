import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { formatMcpScopeLabels } from "@/lib/mcp/scopes";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ApprovalCard,
  EditScopesForm,
  HelpersSkipToggle,
  MintForm,
  OAuthApproverRolesForm,
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
  auth_kind?: string | null;
  oauth_client_name?: string | null;
  oauth_client_id?: string | null;
  approved_by?: string | null;
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
const OAUTH_COLS = `${TOKEN_COLS}, helpers_skip_xos_approval, auto_approve, auth_kind, oauth_client_name, oauth_client_id, approved_by`;

export default async function McpSettingsPage() {
  const me = await getMe();
  if (!me || me.role !== "master_admin") redirect("/no-access");

  let tokens: TokenRow[] = [];
  let setupNeeded = false;
  let helpersSkipReady = false;
  let autoApproveReady = false;
  let oauthReady = false;
  let approverRoles: string[] = ["master_admin"];
  try {
    const admin = createAdminClient();
    const withOauth = await admin
      .from("mcp_service_tokens")
      .select(OAUTH_COLS)
      .order("created_at", { ascending: false });
    if (!withOauth.error) {
      tokens = (withOauth.data ?? []) as TokenRow[];
      helpersSkipReady = true;
      autoApproveReady = true;
      oauthReady = true;
    } else {
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
    }
    if (oauthReady) {
      const settings = await admin.from("mcp_oauth_settings").select("approver_roles").eq("id", true).maybeSingle();
      if (!settings.error && settings.data?.approver_roles) {
        approverRoles = settings.data.approver_roles as string[];
      }
    }
  } catch {
    setupNeeded = true;
  }

  const active = tokens.filter((token) => !token.revoked_at && (token.auth_kind ?? "service") === "service");
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

  const approverEmails = new Map<string, string>();
  if (oauthReady) {
    const ids = [...new Set(tokens.map((t) => t.approved_by).filter(Boolean))] as string[];
    if (ids.length) {
      const { data } = await createAdminClient()
        .from("employees")
        .select("auth_user_id, email, first_name, last_name")
        .in("auth_user_id", ids);
      for (const row of data ?? []) {
        if (!row.auth_user_id) continue;
        const label =
          (row.email as string) ||
          [row.first_name, row.last_name].filter(Boolean).join(" ") ||
          (row.auth_user_id as string);
        approverEmails.set(row.auth_user_id as string, label);
      }
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="page-title mb-1">Agent Access</h1>
        <p className="text-sm text-zinc-500">
          Service tokens and OAuth agent connections. Secrets and codes are stored only as hashes. Every MCP call is audited under the identity name.
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
          {!oauthReady ? (
            <div className="card p-4 text-sm text-zinc-600">
              OAuth Connect needs migration <code>00235_mcp_oauth.sql</code> before OAuth grants and approver settings appear. This page does not apply it.
            </div>
          ) : (
            <OAuthApproverRolesForm roles={approverRoles} />
          )}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="table-head text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Scopes</th>
                  <th className="px-3 py-2">Trust</th>
                  <th className="px-3 py-2">Helpers</th>
                  <th className="px-3 py-2">Last used</th>
                  <th className="px-3 py-2">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const isOauth = (token.auth_kind ?? "service") === "oauth";
                  return (
                    <tr key={token.id} className="border-t border-zinc-200 align-top">
                      <td className="px-3 py-2">
                        <div>{token.name}</div>
                        {isOauth ? (
                          <div className="mt-1 text-[11px] text-zinc-500">
                            Client: {token.oauth_client_name || token.oauth_client_id || "—"}
                            {token.approved_by ? (
                              <> · Approved by {approverEmails.get(token.approved_by) || "staff"}</>
                            ) : null}
                            <div>Created {new Date(token.created_at).toLocaleString()}</div>
                          </div>
                        ) : (
                          <div className="mt-1 font-mono text-[11px] text-zinc-400">{token.token_prefix}…</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{isOauth ? "OAuth" : "Service token"}</td>
                      <td className="px-3 py-2 text-xs">
                        <div>{formatMcpScopeLabels(token.scopes ?? [])}</div>
                        {!token.revoked_at ? (
                          <div className="mt-2">
                            <EditScopesForm id={token.id} scopes={token.scopes ?? []} />
                          </div>
                        ) : null}
                      </td>
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
                  );
                })}
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
