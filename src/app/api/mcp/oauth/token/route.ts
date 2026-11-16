import { handleTokenRequest, parseBasicAuth } from "@/lib/mcp/oauth/server";
import { supabaseOAuthStore } from "@/lib/mcp/oauth/supabaseOAuthStore";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json",
};

function formValue(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value == null || value === "" ? null : value;
}

/** OAuth 2.1 token endpoint: authorization_code (+ PKCE) and refresh_token (rotate on use). */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  let params: URLSearchParams;
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value != null) params.set(key, String(value));
      }
    } else {
      params = new URLSearchParams(await req.text());
    }
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "Could not parse token request" },
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const basic = parseBasicAuth(req.headers.get("authorization"));
  try {
    const result = await handleTokenRequest(supabaseOAuthStore(createAdminClient()), {
      grant_type: formValue(params, "grant_type"),
      code: formValue(params, "code"),
      redirect_uri: formValue(params, "redirect_uri"),
      code_verifier: formValue(params, "code_verifier"),
      refresh_token: formValue(params, "refresh_token"),
      client_id: formValue(params, "client_id"),
      client_secret: formValue(params, "client_secret"),
      resource: formValue(params, "resource"),
      basicClientId: basic?.clientId ?? null,
      basicClientSecret: basic?.clientSecret ?? null,
    });
    if (!result.ok) {
      const headers = { ...JSON_HEADERS };
      if (result.body.error === "invalid_client") {
        return Response.json(result.body, {
          status: result.status,
          headers: { ...headers, "WWW-Authenticate": 'Basic realm="xos-mcp-oauth"' },
        });
      }
      return Response.json(result.body, { status: result.status, headers });
    }
    return Response.json(result.value, { status: 200, headers: JSON_HEADERS });
  } catch {
    return Response.json(
      { error: "server_error", error_description: "Token endpoint error" },
      { status: 500, headers: JSON_HEADERS },
    );
  }
}

export function GET() {
  return Response.json(
    { error: "invalid_request", error_description: "Use POST" },
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST" } },
  );
}
