import { NextRequest, NextResponse } from "next/server";
import { consentPath } from "@/lib/mcp/oauth/config";
import { beginAuthorize } from "@/lib/mcp/oauth/server";
import { supabaseOAuthStore } from "@/lib/mcp/oauth/supabaseOAuthStore";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth 2.1 authorization endpoint.
 * Validates the client + PKCE params, stores a pending request, then redirects
 * to the consent screen. Middleware sends unsigned-in staff through /login and
 * back via safeStaffNext.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const store = supabaseOAuthStore(createAdminClient());
  const started = await beginAuthorize(store, {
    response_type: url.searchParams.get("response_type"),
    client_id: url.searchParams.get("client_id"),
    redirect_uri: url.searchParams.get("redirect_uri"),
    scope: url.searchParams.get("scope"),
    state: url.searchParams.get("state"),
    code_challenge: url.searchParams.get("code_challenge"),
    code_challenge_method: url.searchParams.get("code_challenge_method"),
    resource: url.searchParams.get("resource"),
  });

  if (!started.ok) {
    const clientId = url.searchParams.get("client_id");
    const redirectUri = url.searchParams.get("redirect_uri");
    if (clientId && redirectUri) {
      const client = await store.findClient(clientId);
      if (client?.redirect_uris.includes(redirectUri)) {
        const target = new URL(redirectUri);
        target.searchParams.set("error", started.body.error);
        if (started.body.error_description) {
          target.searchParams.set("error_description", started.body.error_description);
        }
        const state = url.searchParams.get("state");
        if (state) target.searchParams.set("state", state);
        return NextResponse.redirect(target.toString());
      }
    }
    return NextResponse.json(started.body, { status: started.status });
  }

  const consent = new URL(consentPath(), url.origin);
  consent.searchParams.set("request_id", started.value.pendingId);
  return NextResponse.redirect(consent);
}
