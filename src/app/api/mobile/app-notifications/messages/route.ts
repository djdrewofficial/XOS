import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMobileUser, isUuid } from "@/lib/mobileCouple";
import { resolveEventRole } from "@/lib/planning";
import { listPendingAppMessages } from "@/lib/appNotifications";
import { createClient } from "@supabase/supabase-js";
import { bearerToken } from "@/lib/mobileCouple";

/* GET ?eventId= — pending messages + popups for the signed-in couple-app user. */
export async function GET(req: Request) {
  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;

  const eventId = new URL(req.url).searchParams.get("eventId") ?? "";
  if (!isUuid(eventId)) return NextResponse.json({ error: "eventId required" }, { status: 400 });

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
  const result = await listPendingAppMessages(admin, caller.userId, eventId);
  return NextResponse.json(result);
}
