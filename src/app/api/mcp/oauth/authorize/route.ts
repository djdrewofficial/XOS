import { NextRequest, NextResponse } from "next/server";
import { completeAuthorize, validateAuthorizeRequest } from "@/lib/mcp/oauth/server";
import { resolveOAuthStaffUser } from "@/lib/mcp/oauth/staffUser";
import { supabaseOAuthStore } from "@/lib/mcp/oauth/supabaseOAuthStore";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth 2.1 authorization endpoint.
 * Signed-in staff are auto-approved: scopes come from their XOS role (no extra UI).
 * Unsigned-in visitors go to /login and return here.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const store = supabaseOAuthStore(createAdminClient());
  const query = {
    response_type: url.searchParams.get("response_type"),
    client_id: url.searchParams.get("client_id"),
    redirect_uri: url.searchParams.get("redirect_uri"),
    scope: url.searchParams.get("scope"),
    state: url.searchParams.get("state"),
    code_challenge: url.searchParams.get("code_challenge"),
    code_challenge_method: url.searchParams.get("code_challenge_method"),
    resource: url.searchParams.get("resource"),
  };

  const validated = await validateAuthorizeRequest(store, query);
  if (!validated.ok) {
    return redirectOAuthError(store, query, validated.body.error, validated.body.error_description, validated.status);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", `${url.pathname}${url.search}`);
    return NextResponse.redirect(login);
  }

  const staff = await resolveOAuthStaffUser(createAdminClient(), {
    id: user.id,
    email: user.email,
  });
  if (!staff) {
    return redirectOAuthError(store, query, "access_denied", "Sign in with an XOS staff account", 403);
  }

  const completed = await completeAuthorize(store, query, {
    userId: staff.userId,
    displayName: staff.displayName,
    scopes: staff.scopes,
  });
  if (!completed.ok) {
    return redirectOAuthError(store, query, completed.body.error, completed.body.error_description, completed.status);
  }
  return NextResponse.redirect(completed.value.redirectTo);
}

async function redirectOAuthError(
  store: ReturnType<typeof supabaseOAuthStore>,
  query: {
    client_id: string | null;
    redirect_uri: string | null;
    state: string | null;
  },
  error: string,
  description: string | undefined,
  status: number,
) {
  if (query.client_id && query.redirect_uri) {
    const client = await store.findClient(query.client_id);
    if (client?.redirect_uris.includes(query.redirect_uri)) {
      const target = new URL(query.redirect_uri);
      target.searchParams.set("error", error);
      if (description) target.searchParams.set("error_description", description);
      if (query.state) target.searchParams.set("state", query.state);
      return NextResponse.redirect(target.toString());
    }
  }
  return NextResponse.json(
    { error, error_description: description },
    { status },
  );
}
