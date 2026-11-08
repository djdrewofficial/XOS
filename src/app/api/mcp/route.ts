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

const MAX_BODY_BYTES = 256 * 1024;

function clientIp(req: Request): string | null {
  // This route is reached on the Netlify origin, not through the Cloudflare
  // transform that stamps x-origin-verify. A caller can set cf-connecting-ip
  // themselves, so it is not a client address here. Netlify sets
  // x-nf-client-connection-ip on the way in.
  const nf = req.headers.get("x-nf-client-connection-ip");
  return nf?.trim() || null;
}

/** Streamable HTTP MCP, stateless. One JSON-RPC message per POST.
    Agents call the Netlify origin, not the Cloudflare-proxied site name. */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body is too large." } },
      { status: 413, headers: JSON_HEADERS },
    );
  }
  const version = req.headers.get("mcp-protocol-version");
  if (version && version !== "2025-03-26" && version !== "2025-06-18") {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32602, message: `Unsupported MCP-Protocol-Version ${version}` } },
      { status: 400, headers: JSON_HEADERS },
    );
  }
  const accept = req.headers.get("accept");
  if (accept && !accept.includes("application/json") && !accept.includes("*/*")) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Accept must include application/json." } },
      { status: 406, headers: JSON_HEADERS },
    );
  }
  let body: unknown = null;
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body is too large." } },
      { status: 413, headers: JSON_HEADERS },
    );
  }
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
