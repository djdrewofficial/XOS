import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMobileUser, isUuid } from "@/lib/mobileCouple";
import { markAppNotification } from "@/lib/appNotifications";

/* POST { action: "opened" | "dismissed" } — mark a message for the signed-in user. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action === "dismissed" ? "dismissed" : body.action === "opened" ? "opened" : null;
  if (!action) return NextResponse.json({ error: "action must be opened or dismissed" }, { status: 400 });

  const admin = createAdminClient();
  const result = await markAppNotification(admin, caller.userId, id, action);
  if (!result.ok) {
    return NextResponse.json({ error: result.error === "not_found" ? "Not found" : result.error }, { status: result.error === "not_found" ? 404 : 500 });
  }
  return NextResponse.json({ ok: true });
}
