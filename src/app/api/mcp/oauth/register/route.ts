import { registerClient } from "@/lib/mcp/oauth/server";
import { supabaseOAuthStore } from "@/lib/mcp/oauth/supabaseOAuthStore";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json",
};

/** RFC 7591 dynamic client registration for MCP OAuth clients. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "JSON body required" },
      { status: 400, headers: JSON_HEADERS },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { error: "invalid_request", error_description: "JSON object required" },
      { status: 400, headers: JSON_HEADERS },
    );
  }
  const input = body as {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
    scope?: string;
  };
  try {
    const result = await registerClient(supabaseOAuthStore(createAdminClient()), {
      client_name: input.client_name,
      redirect_uris: Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [],
      grant_types: input.grant_types,
      response_types: input.response_types,
      token_endpoint_auth_method: input.token_endpoint_auth_method,
      scope: input.scope,
    });
    if (!result.ok) {
      return Response.json(result.body, { status: result.status, headers: JSON_HEADERS });
    }
    return Response.json(result.value, { status: 201, headers: JSON_HEADERS });
  } catch {
    return Response.json(
      { error: "server_error", error_description: "Registration failed" },
      { status: 500, headers: JSON_HEADERS },
    );
  }
}

export function GET() {
  return Response.json(
    { error: "invalid_request", error_description: "Use POST to register a client" },
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST" } },
  );
}
