import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMobileUser, isUuid, bearerToken } from "@/lib/mobileCouple";
import { resolveEventRole } from "@/lib/planning";
import { resolveScreenForEvent } from "@/lib/appNotifications";
import { createClient } from "@supabase/supabase-js";

/* GET ?eventId= — custom screen with per-DJ content resolved.
   Embed HTML is staff-authored; the app must render it in a sandboxed WebView
   (see response.render) and open links externally / in an in-app browser. */
export async function GET(req: Request, ctx: { params: Promise<{ screenId: string }> }) {
  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;

  const { screenId } = await ctx.params;
  const eventId = new URL(req.url).searchParams.get("eventId") ?? "";
  if (!isUuid(screenId) || !isUuid(eventId)) {
    return NextResponse.json({ error: "screenId and eventId required" }, { status: 400 });
  }

  if (!caller.accountType) {
    return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
  }
  const rls = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${bearerToken(req)}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const role = await resolveEventRole(rls, caller.userId, caller.accountType, eventId);
  if (!role || (role !== "host" && role !== "guest" && role !== "staff")) {
    return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
  }

  const admin = createAdminClient();
  const screen = await resolveScreenForEvent(admin, screenId, eventId);
  if (!screen) return NextResponse.json({ error: "Screen not found" }, { status: 404 });

  return NextResponse.json({
    screen,
    /** App rendering contract — do not load embed_html in an unrestricted WebView. */
    security: {
      embed_is_staff_authored: true,
      required_webview: "sandboxed",
      open_links: "external_or_in_app_browser",
      note: "Restrict navigation to screen.render.allowed_origins; block file:// and unexpected schemes.",
    },
  });
}
