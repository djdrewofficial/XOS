import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { getMobileMe } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";
import { runAutomations, fireHelperWebhook } from "@/lib/automations";
import { dispatchNotification } from "@/lib/notify";
import { helperAllowedForEventType, helperAllowedForRole } from "@/lib/helperAccess";
import { canTouchEvent } from "@/lib/fieldStaff";
import { isUuid } from "@/lib/mobileCouple";

/* POST /api/mobile/events/:eventId/action — the XOS Mobile twins of the event
   server actions whose side effects can't run on a phone. Each branch mirrors
   the matching action in src/app/(app)/events/actions.ts, side effects included:

     { action: "helper_sms_prompts", helperId }            → getHelperSmsPrompts → { prompts }
     { action: "run_helper", helperId, smsOverrides? }     → runBookingHelper
     { action: "set_status", statusId }                    → setEventStatus (status_changed automations)
     { action: "add_payment", amount, method?, reason?, paid_at?, notes? }
                                                           → addPayment (payment_received automations)
     { action: "assign_staff", employeeId, role?, flatWage? }
                                                           → assignStaff (staff_assigned notification)

   Auth: Bearer Supabase JWT (route is middleware-exempt under /api/mobile/),
   events = edit. Writes go through the caller's RLS session like the web;
   run_booking_helper is service-role only (00166), exactly as on the web.
   Field staff may only run helpers that list their role, on events they're
   assigned to; everything else here is office-only.
   → 200 {ok:true, ...} | 400 | 401 | 403 {error} */

export const dynamic = "force-dynamic";

type HelperSmsOverride = { skip?: boolean; body?: string };
const SMS_BODY_MAX = 1600; // keep in step with events/actions.ts

function cleanSmsOverrides(v: unknown): Record<string, HelperSmsOverride> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, HelperSmsOverride> = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !raw || typeof raw !== "object") continue; // keys are action indexes
    const value = raw as HelperSmsOverride;
    if (value.skip) {
      out[key] = { skip: true };
      continue;
    }
    const body = (typeof value.body === "string" ? value.body : "").trim().slice(0, SMS_BODY_MAX);
    if (body) out[key] = { body };
  }
  return Object.keys(out).length > 0 ? out : null;
}

const text = (v: unknown, max = 2000): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s === "" ? null : s;
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return bad("That event was not found.", 404);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return bad("Unauthorized", 401);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const me = await getMobileMe(supabase, token);
  if (!me) return bad("Unauthorized", 401);
  const denied = await requireMobileStaffModule(supabase, token, "events", "edit");
  if (denied) return denied;
  if (!(await canTouchEvent(supabase, me, eventId))) return bad("Not authorized for this event.", 403);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return bad("Missing action.");
  const admin = createAdminClient();

  try {
    switch (body.action) {
      case "helper_sms_prompts":
      case "run_helper": {
        const helperId = text(body.helperId, 64);
        if (!helperId || !isUuid(helperId)) return bad("Missing helper.");
        const [{ data: scope }, { data: ev }] = await Promise.all([
          admin.from("booking_helpers").select("title, visible_event_type_ids, allowed_roles").eq("id", helperId).maybeSingle(),
          admin.from("events").select("event_type_id").eq("id", eventId).maybeSingle(),
        ]);
        if (!scope) return bad("That helper was not found.", 404);
        if (!helperAllowedForEventType(scope, ev?.event_type_id as string | null)) {
          return bad(`"${scope.title}" isn't set up for this event type.`, 403);
        }
        if (!helperAllowedForRole(scope, me.role)) return bad(`Your role can't run "${scope.title}".`, 403);
        if (me.fieldStaff && !((scope.allowed_roles as string[] | null) ?? []).includes(me.role)) {
          return bad(`Your role can't run "${scope.title}".`, 403);
        }

        if (body.action === "helper_sms_prompts") {
          const { data, error } = await admin.rpc("preview_helper_sms", { p_helper_id: helperId, p_event_id: eventId });
          if (error) return bad(error.message, 500);
          return NextResponse.json({ ok: true, prompts: data ?? [] });
        }

        // 3-arg form = the staff-click entry point (p_manual = true, bypasses comms_paused).
        const { error } = await admin.rpc("run_booking_helper", {
          p_helper_id: helperId,
          p_event_id: eventId,
          p_sms_overrides: cleanSmsOverrides(body.smsOverrides),
        });
        if (error) return bad(error.message, 500);
        await fireHelperWebhook(admin, helperId, eventId);
        const drainer = me.fieldStaff ? admin : supabase;
        await processOutbox(drainer);
        await processSmsOutbox(drainer);
        return NextResponse.json({ ok: true });
      }

      case "set_status": {
        if (me.fieldStaff) return bad("Not authorized.", 403);
        const statusId = text(body.statusId, 64);
        if (!statusId || !isUuid(statusId)) return bad("Missing status.");
        const { error } = await supabase.from("events").update({ status_id: statusId }).eq("id", eventId);
        if (error) return bad(error.message, 500);
        await runAutomations(supabase, eventId, "status_changed", { statusId });
        return NextResponse.json({ ok: true });
      }

      case "add_payment": {
        if (me.fieldStaff) return bad("Not authorized.", 403);
        const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
        if (!(amount > 0)) return bad("Enter a payment amount greater than $0.");
        const { error } = await supabase.from("payments").insert({
          event_id: eventId,
          amount: Math.round(amount * 100) / 100,
          method: text(body.method, 40) ?? "other",
          reason: text(body.reason, 200),
          paid_at: text(body.paid_at, 40) ?? new Date().toISOString(),
          notes: text(body.notes),
        });
        if (error) return bad(error.message, 500);
        await runAutomations(supabase, eventId, "payment_received");
        return NextResponse.json({ ok: true });
      }

      case "assign_staff": {
        if (me.fieldStaff) return bad("Not authorized.", 403);
        const employeeId = text(body.employeeId, 64);
        if (!employeeId || !isUuid(employeeId)) return bad("Pick a staff member.");
        const wage = body.flatWage == null || body.flatWage === "" ? 0 : Number(body.flatWage);
        if (!Number.isFinite(wage)) return bad("Wage must be a number.");
        const { error } = await supabase.from("event_staff").insert({
          event_id: eventId,
          employee_id: employeeId,
          role: text(body.role, 80) ?? "DJ",
          flat_wage: wage,
        });
        if (error) return bad(error.message, 500);
        await dispatchNotification(supabase, "staff_assigned", { eventId, employeeIds: [employeeId] });
        return NextResponse.json({ ok: true });
      }

      default:
        return bad("Unknown action.");
    }
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Something went wrong.", 500);
  }
}
