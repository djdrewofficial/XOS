import { passkeyAuthenticationOptions } from "@/lib/passkeyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  let ceremony: "login" | "stepup" = "login";
  if (raw) {
    try {
      const body = JSON.parse(raw) as { ceremony?: unknown };
      if (body.ceremony === "stepup") ceremony = "stepup";
      else if (body.ceremony !== undefined && body.ceremony !== "login") {
        return Response.json({ ok: false, error: "That passkey didn't work. Try again." }, { status: 400, headers: { "cache-control": "no-store" } });
      }
    } catch {
      return Response.json({ ok: false, error: "That passkey didn't work. Try again." }, { status: 400, headers: { "cache-control": "no-store" } });
    }
  }
  const result = await passkeyAuthenticationOptions(request, ceremony);
  return Response.json(result, {
    status: result.ok ? 200 : result.error.includes("signed in") ? 401 : 400,
    headers: { "cache-control": "no-store" },
  });
}
