import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/signing";

/* PUBLIC short-link redirect (middleware-exempt). /p/<code> → the target path
   (e.g. /proposal/<token>). Counts a click, then 302s. */

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const admin = createAdminClient();
  const { data } = await admin.from("short_links").select("target_path").eq("code", code).maybeSingle();

  if (!data?.target_path) {
    return new NextResponse("This link isn't valid or has expired.", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }

  // Best-effort click count — never block the redirect on it.
  admin.rpc("increment_short_link_click", { p_code: code }).then(
    () => {},
    () => {},
  );

  // Open-redirect guard: only ever redirect within our own origin. Codes are
  // written server-side with internal paths, so a target that isn't a plain
  // same-origin path — external URL, protocol-relative "//host", or "/\host" —
  // is bad/corrupt data, not a valid link.
  const path = data.target_path as string;
  const safeInternal = path.startsWith("/") && path[1] !== "/" && path[1] !== "\\";
  if (!safeInternal) {
    return new NextResponse("This link isn't valid or has expired.", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }
  return NextResponse.redirect(`${appUrl()}${path}`, 302);
}
