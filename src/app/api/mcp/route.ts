import { officeTools } from "@/lib/mcp/tools/office";
import { handleMcp } from "@/lib/mcp/protocol";
import { secretValuesFromEnv } from "@/lib/mcp/redact";
import { supabaseStore } from "@/lib/mcp/supabaseStore";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json",
};

function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const nf = req.headers.get("x-nf-client-connection-ip");
  if (nf) return nf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || null;
}

/** Streamable HTTP MCP, stateless. One JSON-RPC message per POST.
    Agents call the Netlify origin, not the Cloudflare-proxied site name. */
export async function POST(req: Request) {
  let body: unknown = null;
  const text = await req.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        { status: 400, headers: JSON_HEADERS },
      );
    }
  }
  let result: { status: number; body: unknown };
  try {
    const admin = createAdminClient();
    result = await handleMcp(supabaseStore(admin), officeTools, {
      body,
      authorization: req.headers.get("authorization"),
      ip: clientIp(req),
      secrets: secretValuesFromEnv(process.env),
      requestId: req.headers.get("x-request-id"),
      idempotencyKey: req.headers.get("idempotency-key"),
      admin,
    });
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "MCP server error" } },
      { status: 500, headers: JSON_HEADERS },
    );
  }
  if (result.status === 202) return new Response(null, { status: 202 });
  return Response.json(result.body, { status: result.status, headers: JSON_HEADERS });
}

export function GET() {
  return Response.json(
    { error: "This MCP server is stateless. POST a JSON-RPC message. There is no SSE stream." },
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST" } },
  );
}

export function DELETE() {
  return Response.json(
    { error: "This MCP server does not keep a session." },
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST" } },
  );
}
