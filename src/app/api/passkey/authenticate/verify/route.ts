import { passkeyAuthenticationVerify } from "@/lib/passkeyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 20_000) {
    return Response.json({ ok: false, error: "That passkey didn't work. Try again." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  let body: { ceremony?: unknown; response?: unknown };
  try {
    body = JSON.parse(raw) as { ceremony?: unknown; response?: unknown };
  } catch {
    return Response.json({ ok: false, error: "That passkey didn't work. Try again." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const ceremony = body.ceremony === "stepup" ? "stepup" : body.ceremony === "login" ? "login" : null;
  if (!ceremony) {
    return Response.json({ ok: false, error: "That passkey didn't work. Try again." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const result = await passkeyAuthenticationVerify(request, ceremony, body.response);
  return Response.json(result, {
    status: result.ok ? 200 : result.error.includes("signed in") ? 401 : 400,
    headers: { "cache-control": "no-store" },
  });
}
