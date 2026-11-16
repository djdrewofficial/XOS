import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { defaultOAuthScopes } from "@/lib/mcp/oauth/config";
import { canApproveOAuth, requestedScopesFromPending } from "@/lib/mcp/oauth/server";
import { supabaseOAuthStore } from "@/lib/mcp/oauth/supabaseOAuthStore";
import { readMcpScopes, type McpScope } from "@/lib/mcp/scopes";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConsentForm } from "./ConsentForm";

export const dynamic = "force-dynamic";

export default async function McpOAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ request_id?: string }>;
}) {
  const me = await getMe();
  if (!me || me.accountType !== "staff") redirect("/login");

  const store = supabaseOAuthStore(createAdminClient());
  const roles = await store.getApproverRoles();
  if (!canApproveOAuth(me.role, roles)) redirect("/no-access?reason=mcp_oauth");

  const { request_id: requestId } = await searchParams;
  if (!requestId) redirect("/settings/mcp");

  const pending = await store.findPending(requestId);
  const expiresAtMs = pending ? Date.parse(pending.expires_at) : NaN;
  const expired = !Number.isFinite(expiresAtMs) || expiresAtMs <= new Date().getTime();
  if (!pending || pending.consumed_at || expired) {
    return (
      <div className="mx-auto max-w-lg p-8 text-sm text-zinc-600">
        This authorization request expired or was already used. Start the connect flow again from your agent.
      </div>
    );
  }

  const client = await store.findClient(pending.client_id);
  if (!client) {
    return (
      <div className="mx-auto max-w-lg p-8 text-sm text-zinc-600">
        That OAuth client is no longer registered.
      </div>
    );
  }

  const requested = requestedScopesFromPending(pending.scope);
  // Default to read-only; if the client asked for specific scopes, intersect with
  // read defaults for the initial ticks (high-risk still stays off unless requested
  // and explicitly ticked — we only pre-tick non-high-risk requested scopes, else reads).
  const reads = readMcpScopes();
  let defaultScopes: McpScope[] = defaultOAuthScopes();
  if (requested.length) {
    const safeRequested = requested.filter((s) => reads.includes(s));
    if (safeRequested.length) defaultScopes = safeRequested;
  }

  return (
    <ConsentForm
      requestId={pending.id}
      clientName={client.client_name}
      redirectUri={pending.redirect_uri}
      defaultScopes={defaultScopes}
      defaultName={client.client_name.slice(0, 80)}
    />
  );
}
