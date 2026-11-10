import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { getMobileMe, type Me } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";
import { runAutomations, fireHelperWebhook } from "@/lib/automations";
import { dispatchNotification } from "@/lib/notify";
import { helperAllowedForEventType, helperAllowedForRole } from "@/lib/helperAccess";
import { canTouchEvent } from "@/lib/fieldStaff";
import { isUuid } from "@/lib/mobileCouple";
import { applyPackageSelection, assignAddonEquipment } from "@/lib/eventCreate";
import { assignAddonSections, reseedEventPlanning } from "@/lib/planning";
import { autoNameEvent } from "@/lib/eventName";
import { findOrCreateClient } from "@/lib/clients";
import { inviteClientToXos } from "@/lib/accounts";
import { loadEventBundle, generateDocumentRow, renderBlocks } from "@/lib/documentRender";
import { splitSchedule, type SchedRow } from "@/lib/scheduleLock";
import { writeSchedulePreservingPaid } from "@/lib/scheduleWrite";
import { parseSchedulePlan } from "@/lib/paymentSchedule";
import { getOrCreateShortLink } from "@/lib/shortLinks";
import { sanitizeBlocks, docTypeClientLabel } from "@/lib/documentBlocks";
import { appUrl, agreementEmailHtml } from "@/lib/signing";
import { XDOC_CSS } from "@/components/DocumentShell";

/* POST /api/mobile/events/:eventId/action — the XOS Mobile twins of the event
   (and event-document) server actions whose logic or side effects can't run on
   a phone. Each branch mirrors the named web action; the comment on each case
   points at it. Plain field edits with no side effects are written by the app
   directly under RLS, exactly like the web's user-session writes.

   Auth: Bearer Supabase JWT (route is middleware-exempt under /api/mobile/),
   events = edit (document actions: documents = edit) + canTouchEvent. Writes go
   through the caller's RLS session; service role only where the web uses it.
   Field staff may only run helpers that list their role and upload files on
   events they're assigned to; everything else here is office-only.
   → 200 {ok:true, ...} | 400 | 401 | 403 | 404 {error} */

export const dynamic = "force-dynamic";

class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type HelperSmsOverride = { skip?: boolean; body?: string };
const SMS_BODY_MAX = 1600; // keep in step with events/actions.ts
const MAX_UPLOAD = 50 * 1024 * 1024; // keep in step with uploadEventFile

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
const id = (v: unknown, field: string, required = true): string | null => {
  const s = text(v, 64);
  if (!s) {
    if (required) throw new HttpError(`Missing ${field}.`);
    return null;
  }
  if (!isUuid(s)) throw new HttpError(`Invalid ${field}.`);
  return s;
};
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function office(me: Me) {
  if (me.fieldStaff) throw new HttpError("Not authorized.", 403);
}
function tier(me: Me, allowed: string[]) {
  if (!allowed.includes(me.role)) throw new HttpError("Not authorized.", 403);
}
function check(error: { message: string } | null) {
  if (error) throw new HttpError(error.message, 500);
}

/** events/actions.ts actorName, from the Bearer user. */
async function actorName(sb: SupabaseClient, token: string): Promise<string> {
  const { data } = await sb.auth.getUser(token);
  const user = data.user;
  if (!user) return "system";
  const { data: emp } = await sb.from("employees").select("first_name, last_name").eq("auth_user_id", user.id).maybeSingle();
  if (emp) return `${emp.first_name} ${emp.last_name}`.trim();
  return user.email ?? "user";
}

async function eventDoc(sb: SupabaseClient, eventId: string, documentId: string) {
  const { data: doc } = await sb.from("documents").select("*").eq("id", documentId).eq("event_id", eventId).maybeSingle();
  if (!doc) throw new HttpError("Document not found.", 404);
  return doc as Record<string, unknown> & { id: string; signed_at: string | null; status: string; template_id: string | null };
}

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const me = await getMobileMe(supabase, token);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Missing action." }, { status: 400 });
  const action = body.action;

  const denied = await requireMobileStaffModule(supabase, token, action.startsWith("doc_") ? "documents" : "events", "edit");
  if (denied) return denied;
  if (!(await canTouchEvent(supabase, me, eventId))) {
    return NextResponse.json({ error: "Not authorized for this event." }, { status: 403 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await handle(action, body, eventId, me, supabase, token)) });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}

async function handle(
  action: string,
  body: Record<string, unknown>,
  eventId: string,
  me: Me,
  supabase: SupabaseClient,
  token: string,
): Promise<Record<string, unknown>> {
  const admin = createAdminClient();

  switch (action) {
    /* ------------------------------ booking helpers ------------------------------ */
    case "helper_sms_prompts": // getHelperSmsPrompts
    case "run_helper": {
      // runBookingHelper
      const helperId = id(body.helperId, "helper")!;
      const [{ data: scope }, { data: ev }] = await Promise.all([
        admin.from("booking_helpers").select("title, visible_event_type_ids, allowed_roles").eq("id", helperId).maybeSingle(),
        admin.from("events").select("event_type_id").eq("id", eventId).maybeSingle(),
      ]);
      if (!scope) throw new HttpError("That helper was not found.", 404);
      if (!helperAllowedForEventType(scope, ev?.event_type_id as string | null)) {
        throw new HttpError(`"${scope.title}" isn't set up for this event type.`, 403);
      }
      if (!helperAllowedForRole(scope, me.role)) throw new HttpError(`Your role can't run "${scope.title}".`, 403);
      if (me.fieldStaff && !((scope.allowed_roles as string[] | null) ?? []).includes(me.role)) {
        throw new HttpError(`Your role can't run "${scope.title}".`, 403);
      }
      if (action === "helper_sms_prompts") {
        const { data, error } = await admin.rpc("preview_helper_sms", { p_helper_id: helperId, p_event_id: eventId });
        check(error);
        return { prompts: data ?? [] };
      }
      // 3-arg form = the staff-click entry point (p_manual = true, bypasses comms_paused).
      const { error } = await admin.rpc("run_booking_helper", {
        p_helper_id: helperId,
        p_event_id: eventId,
        p_sms_overrides: cleanSmsOverrides(body.smsOverrides),
      });
      check(error);
      await fireHelperWebhook(admin, helperId, eventId);
      const drainer = me.fieldStaff ? admin : supabase;
      await processOutbox(drainer);
      await processSmsOutbox(drainer);
      return {};
    }

    /* ------------------------------ status / booking ------------------------------ */
    case "set_status": {
      // setEventStatus
      office(me);
      const statusId = id(body.statusId, "status")!;
      check((await supabase.from("events").update({ status_id: statusId }).eq("id", eventId)).error);
      await runAutomations(supabase, eventId, "status_changed", { statusId });
      return {};
    }
    case "update_booking_info": {
      // updateBookingInfo
      office(me);
      const { data: before } = await supabase.from("events").select("status_id").eq("id", eventId).maybeSingle();
      const statusId = id(body.status_id, "status", false);
      check(
        (
          await supabase
            .from("events")
            .update({
              status_id: statusId,
              inquiry_source_id: id(body.inquiry_source_id, "inquiry source", false),
              salesperson_id: id(body.salesperson_id, "salesperson", false),
              point_of_contact_employee_id: id(body.point_of_contact_employee_id, "point of contact", false),
            })
            .eq("id", eventId)
        ).error,
      );
      if (statusId && statusId !== before?.status_id) {
        await runAutomations(supabase, eventId, "status_changed", { statusId });
      }
      return {};
    }
    case "archive": {
      // archiveEvent
      office(me);
      tier(me, ["master_admin", "admin", "salesperson"]);
      check((await supabase.from("events").update({ archived_at: new Date().toISOString() }).eq("id", eventId)).error);
      await supabase.from("email_log").update({ status: "cancelled" }).eq("event_id", eventId).eq("status", "queued");
      await supabase.from("sms_log").update({ status: "cancelled" }).eq("event_id", eventId).eq("status", "queued");
      await supabase.from("event_logs").insert({ event_id: eventId, actor: await actorName(supabase, token), action: "Event archived" });
      return {};
    }
    case "unarchive": {
      // unarchiveEvent
      office(me);
      tier(me, ["master_admin", "admin", "salesperson"]);
      check((await supabase.from("events").update({ archived_at: null }).eq("id", eventId)).error);
      await supabase.from("event_logs").insert({ event_id: eventId, actor: await actorName(supabase, token), action: "Event unarchived" });
      return {};
    }
    case "delete_event": {
      // deleteEvent — master_admin only, never with payment history
      office(me);
      tier(me, ["master_admin"]);
      const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("event_id", eventId);
      if ((count ?? 0) > 0) {
        throw new HttpError(
          "This event has payment history and can't be permanently deleted — that would orphan its payment records. Archive it instead: it'll be hidden and all automations stop, but the money records stay attributable.",
        );
      }
      check((await supabase.from("events").delete().eq("id", eventId)).error);
      return {};
    }
    case "proposal_link": {
      // getProposalShortLink
      office(me);
      const { data: ev } = await admin.from("events").select("pay_token").eq("id", eventId).maybeSingle();
      if (!ev?.pay_token) throw new HttpError("This event has no proposal link yet.");
      const url = await getOrCreateShortLink(admin, { eventId, kind: "proposal", targetPath: `/offer/${ev.pay_token}` });
      return { url };
    }
    case "set_planning_template": {
      // setEventPlanningTemplate — picking a template RE-SEEDS the planner
      office(me);
      const templateId = id(body.templateId, "template", false);
      if (!templateId) {
        check((await supabase.from("events").update({ planning_template_id: null }).eq("id", eventId)).error);
      } else {
        await reseedEventPlanning(eventId, templateId);
      }
      return {};
    }

    /* ------------------------------ money ------------------------------ */
    case "add_payment": {
      // addPayment
      office(me);
      const amount = num(body.amount);
      if (!(amount > 0)) throw new HttpError("Enter a payment amount greater than $0.");
      check(
        (
          await supabase.from("payments").insert({
            event_id: eventId,
            amount: round2(amount),
            method: text(body.method, 40) ?? "other",
            reason: text(body.reason, 200),
            paid_at: text(body.paid_at, 40) ?? new Date().toISOString(),
            notes: text(body.notes),
          })
        ).error,
      );
      await runAutomations(supabase, eventId, "payment_received");
      return {};
    }
    case "confirm_payment": {
      // confirmPayment
      office(me);
      const paymentId = id(body.paymentId, "payment")!;
      const note = text(body.note);
      const { data: pending } = await supabase.from("payments").select("amount").eq("id", paymentId).eq("event_id", eventId).maybeSingle();
      if (!pending) throw new HttpError("Payment not found.", 404);
      if (!(Number(pending.amount) > 0)) throw new HttpError("This payment's amount is invalid — remove it and re-enter.");
      const [{ data: scheduled }, { data: prior }] = await Promise.all([
        supabase.from("scheduled_payments").select("id, seq").eq("event_id", eventId).order("seq"),
        supabase.from("payments").select("scheduled_payment_id").eq("event_id", eventId).eq("status", "approved").is("deleted_at", null),
      ]);
      const taken = new Set((prior ?? []).map((p) => p.scheduled_payment_id).filter(Boolean));
      const scheduledId = (scheduled ?? []).find((s) => !taken.has(s.id))?.id ?? null;
      const patch: Record<string, unknown> = { status: "approved", scheduled_payment_id: scheduledId, paid_at: new Date().toISOString() };
      if (note) patch.notes = note;
      check((await supabase.from("payments").update(patch).eq("id", paymentId).eq("event_id", eventId)).error);
      await runAutomations(supabase, eventId, "payment_received");
      return {};
    }
    case "generate_schedule": {
      // addScheduledPayments — total comes from the event bundle, not the phone
      office(me);
      const plan = parseSchedulePlan(text(body.plan, 20));
      if (!plan || plan.kind === "net") throw new HttpError("Pick Full payment due or a deposit + installment split.");
      const bundle = await loadEventBundle(supabase, eventId);
      if (!bundle) throw new HttpError("Event not found.", 404);
      const { data: ev } = await supabase.from("events").select("package_id, event_date").eq("id", eventId).single();
      let terms: "days_before" | "net_days_after" = "days_before";
      let termsDays = 30;
      let allowedSplits: number[] = [1, 2, 3];
      if (ev?.package_id) {
        const { data: pkg } = await supabase
          .from("packages")
          .select("payment_terms, payment_terms_days, allowed_splits")
          .eq("id", ev.package_id)
          .single();
        if (pkg) {
          terms = (pkg.payment_terms as typeof terms) ?? "days_before";
          termsDays = pkg.payment_terms_days ?? 30;
          allowedSplits = pkg.allowed_splits?.length ? pkg.allowed_splits : [1, 2, 3];
        }
      }
      if (plan.kind === "split" && !allowedSplits.includes(plan.count)) {
        throw new HttpError(`This package allows ${allowedSplits.join(", ")} payment split(s) — ${plan.count} is not permitted.`);
      }
      await writeSchedulePreservingPaid(supabase, eventId, {
        total: bundle.total,
        deposit: Math.max(0, num(body.deposit)),
        eventDate: (ev?.event_date as string | null) ?? null,
        terms,
        termsDays,
        plan,
      });
      return {};
    }
    case "save_remaining_schedule": {
      // saveRemainingSchedule
      office(me);
      const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]).slice(0, 24) : [];
      const [bundle, { data: sched }, { data: approved }] = await Promise.all([
        loadEventBundle(supabase, eventId),
        supabase.from("scheduled_payments").select("id, seq, amount, due_date, label").eq("event_id", eventId).order("seq"),
        supabase.from("payments").select("amount, scheduled_payment_id").eq("event_id", eventId).eq("status", "approved").is("deleted_at", null),
      ]);
      if (!bundle) throw new HttpError("Event not found.", 404);
      const { locked, open, lockedSum } = splitSchedule(
        (sched ?? []) as SchedRow[],
        (approved ?? []) as { amount: number; scheduled_payment_id: string | null }[],
      );
      const openIds = new Set(open.map((r) => r.id));
      const lockedIds = new Set(locked.map((r) => r.id));
      const keep = rows
        .map((r) => ({ id: id(r.id, "installment", false), amount: round2(num(r.amount)), due_date: text(r.due_date, 10) }))
        .filter((r) => r.amount > 0);
      if (keep.some((r) => r.id && lockedIds.has(r.id))) throw new HttpError("Paid installments can't be changed.");
      if (keep.some((r) => r.id && !openIds.has(r.id))) throw new HttpError("The schedule changed — refresh and try again.");
      const target = round2(bundle.total - lockedSum);
      const sum = round2(keep.reduce((s, r) => s + r.amount, 0));
      if (Math.abs(sum - target) >= 0.01) {
        throw new HttpError(`Remaining payments add up to $${sum.toFixed(2)} — they need to total $${target.toFixed(2)}.`);
      }
      const keptIds = new Set(keep.map((r) => r.id).filter(Boolean) as string[]);
      const removed = open.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
      if (removed.length) check((await supabase.from("scheduled_payments").delete().in("id", removed)).error);
      let seq = locked.reduce((m, r) => Math.max(m, r.seq), 0);
      const sorted = [...keep].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
      for (const [i, r] of sorted.entries()) {
        seq++;
        const label = i === sorted.length - 1 ? "Final Payment" : `Payment ${seq}`;
        const row = { seq, amount: r.amount, due_date: r.due_date || null, label };
        check(
          (r.id
            ? await supabase.from("scheduled_payments").update(row).eq("id", r.id)
            : await supabase.from("scheduled_payments").insert({ ...row, event_id: eventId })
          ).error,
        );
      }
      await supabase.from("events").update({ schedule_ack_total: bundle.total }).eq("id", eventId);
      return {};
    }
    case "ack_schedule": {
      // acknowledgeScheduleTotal
      office(me);
      const bundle = await loadEventBundle(supabase, eventId);
      if (bundle) await supabase.from("events").update({ schedule_ack_total: bundle.total }).eq("id", eventId);
      return {};
    }
    case "update_financials": {
      // updateEventFinancials (incl. the total-floor discount clamp + package defaults)
      office(me);
      const { data: before } = await supabase.from("events").select("package_id, event_date, venue_id").eq("id", eventId).single();
      const newPackageId = id(body.package_id, "package", false);
      const overrideSubmitted = body.package_price_override !== null && body.package_price_override !== undefined && body.package_price_override !== "";
      const nn = (v: unknown) => Math.max(0, num(v));
      const override = overrideSubmitted ? nn(body.package_price_override) : null;
      const overtime = nn(body.overtime_fee);
      const travel = nn(body.travel_fee);
      let discount1 = nn(body.discount1_amount);
      let discount2 = nn(body.discount2_amount);
      const pkgId = newPackageId ?? before?.package_id ?? null;
      let pkgPrice = override ?? 0;
      if (override == null && pkgId) {
        const { data: pkg } = await supabase.from("packages").select("default_price").eq("id", pkgId).maybeSingle();
        pkgPrice = Number(pkg?.default_price ?? 0);
      }
      const [{ data: eAddons }, venueRes] = await Promise.all([
        supabase.from("event_addons").select("quantity, price_override, price_locked, addon:addons(default_price)").eq("event_id", eventId),
        before?.venue_id
          ? supabase.from("venues").select("setup_fee").eq("id", before.venue_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const addonsTotal = (eAddons ?? []).reduce((s, a) => {
        const unit = a.price_override ?? a.price_locked ?? (a.addon as { default_price?: number } | null)?.default_price ?? 0;
        return s + Number(a.quantity) * Number(unit);
      }, 0);
      const venueSetup = Number((venueRes.data as { setup_fee?: number } | null)?.setup_fee ?? 0);
      const subtotal = pkgPrice + overtime + travel + addonsTotal + venueSetup;
      if (subtotal > 0) {
        discount1 = Math.min(discount1, subtotal);
        discount2 = Math.min(discount2, Math.max(0, subtotal - discount1));
      }
      const patch: Record<string, unknown> = {
        package_id: newPackageId,
        package_price_override: override,
        deposit_value: nn(body.deposit_value),
        overtime_fee: overtime,
        travel_fee: travel,
        discount1_amount: discount1,
        discount2_amount: discount2,
      };
      // labels live next to the amounts on the event row (web edits them in the same form)
      if ("discount1_label" in body) patch.discount1_label = text(body.discount1_label, 120);
      if ("discount2_label" in body) patch.discount2_label = text(body.discount2_label, 120);
      check((await supabase.from("events").update(patch).eq("id", eventId)).error);
      if (newPackageId && newPackageId !== before?.package_id) {
        await applyPackageSelection(supabase, eventId, newPackageId, (before?.event_date as string | null) ?? null, overrideSubmitted);
      }
      return {};
    }
    case "add_addon": {
      // addEventAddon (incl. default equipment + planner sections)
      office(me);
      const addonId = id(body.addonId, "add-on")!;
      let priceOverride: number | null = null;
      if (body.priceOverride !== null && body.priceOverride !== undefined && body.priceOverride !== "") {
        const entered = num(body.priceOverride);
        const { data: addon } = await supabase.from("addons").select("default_price").eq("id", addonId).single();
        if (!addon || Number(addon.default_price) !== entered) priceOverride = entered;
      }
      check(
        (
          await supabase.from("event_addons").insert({
            event_id: eventId,
            addon_id: addonId,
            quantity: Math.max(1, Math.round(num(body.quantity) || 1)),
            price_override: priceOverride,
          })
        ).error,
      );
      await assignAddonEquipment(supabase, eventId, addonId);
      await assignAddonSections(eventId, addonId);
      return {};
    }

    /* ------------------------------ staff ------------------------------ */
    case "assign_staff": {
      // assignStaff
      office(me);
      const employeeId = id(body.employeeId, "staff member")!;
      check(
        (
          await supabase.from("event_staff").insert({
            event_id: eventId,
            employee_id: employeeId,
            role: text(body.role, 80) ?? "DJ",
            flat_wage: num(body.flatWage),
          })
        ).error,
      );
      await dispatchNotification(supabase, "staff_assigned", { eventId, employeeIds: [employeeId] });
      return {};
    }

    /* ------------------------------ clients ------------------------------ */
    case "add_client":
    case "create_client": {
      // addEventClient / createClientAndAttach
      office(me);
      let clientId: string;
      if (action === "add_client") {
        clientId = id(body.clientId, "client")!;
      } else {
        const firstName = text(body.first_name, 120);
        if (!firstName) throw new HttpError("First name is required.");
        clientId = (
          await findOrCreateClient(supabase, {
            first_name: firstName,
            last_name: text(body.last_name, 120) ?? "",
            cell_phone: text(body.cell_phone, 40),
            email: text(body.email, 200),
          })
        ).id;
      }
      const { count } = await supabase.from("event_clients").select("id", { count: "exact", head: true }).eq("event_id", eventId);
      const isFirst = (count ?? 0) === 0;
      check(
        (
          await supabase.from("event_clients").insert({
            event_id: eventId,
            client_id: clientId,
            role: text(body.role, 80) ?? "Client",
            is_primary: isFirst,
          })
        ).error,
      );
      if (isFirst) await supabase.from("events").update({ client_id: clientId }).eq("id", eventId);
      await autoNameEvent(supabase, eventId);
      return { clientId };
    }
    case "remove_client": {
      // removeEventClient
      office(me);
      const eventClientId = id(body.eventClientId, "client link")!;
      const { data: links } = await supabase.from("event_clients").select("id, client_id, is_primary").eq("event_id", eventId);
      if ((links ?? []).length <= 1) throw new HttpError("An event must always have at least one client.");
      const removed = (links ?? []).find((l) => l.id === eventClientId);
      if (!removed) throw new HttpError("That client isn't on this event.", 404);
      check((await supabase.from("event_clients").delete().eq("id", eventClientId)).error);
      if (removed.is_primary) {
        const next = (links ?? []).find((l) => l.id !== eventClientId)!;
        await supabase.from("event_clients").update({ is_primary: true }).eq("id", next.id);
        await supabase.from("events").update({ client_id: next.client_id }).eq("id", eventId);
      }
      return {};
    }
    case "set_primary_client": {
      // setPrimaryEventClient
      office(me);
      const eventClientId = id(body.eventClientId, "client link")!;
      const { data: link } = await supabase.from("event_clients").select("client_id").eq("id", eventClientId).eq("event_id", eventId).maybeSingle();
      if (!link) throw new HttpError("That client isn't on this event.", 404);
      await supabase.from("event_clients").update({ is_primary: false }).eq("event_id", eventId);
      await supabase.from("event_clients").update({ is_primary: true }).eq("id", eventClientId);
      await supabase.from("events").update({ client_id: link.client_id }).eq("id", eventId);
      return {};
    }
    case "invite_client": {
      // inviteEventClientToXos
      office(me);
      const clientId = id(body.clientId, "client")!;
      const { data: c } = await supabase.from("clients").select("email, first_name").eq("id", clientId).maybeSingle();
      if (!c?.email) throw new HttpError("Add an email to this client first.");
      const res = await inviteClientToXos({ clientId, eventId, email: c.email, name: c.first_name });
      if (!res.ok) throw new HttpError(res.error ?? "Couldn't send the invite.");
      return { notice: res.notice ?? null };
    }

    /* ------------------------------ files ------------------------------ */
    case "file_upload_url": {
      // uploadEventFile, step 1: the phone uploads straight to storage with a signed URL
      const name = text(body.name, 200) ?? "File";
      const size = num(body.size);
      if (size > MAX_UPLOAD) throw new HttpError("File is too large (max 50MB).");
      const ext = (name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "bin";
      const path = `${eventId}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await admin.storage.from("event-files").createSignedUploadUrl(path);
      if (error || !data) throw new HttpError(error?.message ?? "Couldn't start the upload.", 500);
      return { path, signedUrl: data.signedUrl, token: data.token };
    }
    case "file_register": {
      // uploadEventFile, step 2: record the uploaded object
      const path = text(body.path, 200);
      if (!path || !path.startsWith(`${eventId}/`) || path.includes("..")) throw new HttpError("Invalid upload.");
      const dir = path.slice(0, path.lastIndexOf("/"));
      const { data: listed } = await admin.storage.from("event-files").list(dir, { search: path.slice(dir.length + 1) });
      if (!(listed ?? []).length) throw new HttpError("The upload didn't finish — try again.");
      const contentType = text(body.contentType, 120) ?? "application/octet-stream";
      check(
        (
          await admin.from("event_files").insert({
            event_id: eventId,
            name: text(body.name, 200) ?? "File",
            path,
            content_type: contentType,
            size_bytes: Math.max(0, Math.round(num(body.size))),
            source: "upload",
            label_id: id(body.labelId, "label", false),
          })
        ).error,
      );
      return {};
    }
    case "set_file_label": {
      // setEventFileLabel
      office(me);
      const fileId = id(body.fileId, "file")!;
      check((await admin.from("event_files").update({ label_id: id(body.labelId, "label", false) }).eq("id", fileId).eq("event_id", eventId)).error);
      return {};
    }
    case "delete_file": {
      // deleteEventFile
      office(me);
      const fileId = id(body.fileId, "file")!;
      const { data: f } = await admin.from("event_files").select("path").eq("id", fileId).eq("event_id", eventId).maybeSingle();
      if (f?.path) await admin.storage.from("event-files").remove([f.path]);
      check((await admin.from("event_files").delete().eq("id", fileId).eq("event_id", eventId)).error);
      return {};
    }

    /* ------------------------------ documents (documents = edit) ------------------------------ */
    case "doc_generate": {
      // generateDocument
      office(me);
      const templateId = id(body.templateId, "template")!;
      const doc = await generateDocumentRow(supabase, templateId, eventId);
      if (!doc) throw new HttpError("Could not render document for this event.", 500);
      return { document: doc };
    }
    case "doc_regenerate": {
      // regenerateDocument
      office(me);
      const doc = await eventDoc(supabase, eventId, id(body.documentId, "document")!);
      if (doc.signed_at) throw new HttpError("Signed documents are locked.");
      const { data: template } = await supabase.from("document_templates").select("blocks").eq("id", doc.template_id ?? "").maybeSingle();
      if (!template) throw new HttpError("Original template no longer exists.");
      const rendered = await renderBlocks(supabase, eventId, sanitizeBlocks(template.blocks));
      if (!rendered) throw new HttpError("Could not render document.", 500);
      check((await supabase.from("documents").update({ blocks: rendered, updated_at: new Date().toISOString() }).eq("id", doc.id)).error);
      return {};
    }
    case "doc_set_status": {
      // setDocumentStatus
      office(me);
      const status = text(body.status, 20);
      if (!status || !["draft", "final", "sent", "void"].includes(status)) throw new HttpError("Invalid status.");
      const doc = await eventDoc(supabase, eventId, id(body.documentId, "document")!);
      if (doc.signed_at && status !== "void") throw new HttpError("Signed documents are locked.");
      check((await supabase.from("documents").update({ status, updated_at: new Date().toISOString() }).eq("id", doc.id)).error);
      return {};
    }
    case "doc_set_visibility": {
      // setDocumentVisibility
      office(me);
      const doc = await eventDoc(supabase, eventId, id(body.documentId, "document")!);
      check(
        (await supabase.from("documents").update({ visible_to_client: body.visible === true, updated_at: new Date().toISOString() }).eq("id", doc.id))
          .error,
      );
      return {};
    }
    case "doc_delete": {
      // deleteDocument
      office(me);
      const doc = await eventDoc(supabase, eventId, id(body.documentId, "document")!);
      if (doc.signed_at) throw new HttpError("Signed documents can't be deleted — void them instead.");
      check((await supabase.from("documents").delete().eq("id", doc.id)).error);
      return {};
    }
    case "doc_send": {
      // sendForSignature
      office(me);
      const documentId = id(body.documentId, "document")!;
      const [{ data: doc }, { data: cs }] = await Promise.all([
        supabase
          .from("documents")
          .select("*, event:events(id, name, client:clients(first_name, last_name, email))")
          .eq("id", documentId)
          .eq("event_id", eventId)
          .maybeSingle(),
        supabase.from("company_settings").select("company_name, from_name, from_email, reply_to").eq("id", true).maybeSingle(),
      ]);
      if (!doc) throw new HttpError("Document not found.", 404);
      if (doc.signed_at) throw new HttpError("Already signed.");
      if (doc.status === "void") throw new HttpError("Document is void.");
      const ev = doc.event as unknown as { id: string; client: { first_name: string; email: string | null } | null } | null;
      const clientEmail = ev?.client?.email;
      if (!clientEmail) throw new HttpError("The event's primary client has no email address on file.");
      const companyName = cs?.company_name ?? "Xpress Entertainment";
      const firstName = ev?.client?.first_name ?? "there";
      const docLabel = docTypeClientLabel(doc.doc_type);
      const bundle = await loadEventBundle(supabase, eventId);
      if (!bundle) throw new HttpError("Could not load event data for the email.", 500);
      check(
        (
          await supabase.from("email_log").insert({
            event_id: eventId,
            to_address: clientEmail,
            from_name: cs?.from_name ?? companyName,
            from_address: cs?.from_email ?? null,
            reply_to: cs?.reply_to ?? null,
            subject: `Your ${docLabel} is ready, ${firstName}! 🎉`,
            body_html: agreementEmailHtml({
              bundle,
              docLabel,
              firstName,
              buttonUrl: `${appUrl()}/sign/${doc.access_token}`,
              companyName,
            }),
          })
        ).error,
      );
      await processOutbox(supabase);
      await supabase
        .from("documents")
        .update({ status: "sent", visible_to_client: true, updated_at: new Date().toISOString() })
        .eq("id", documentId);
      return {};
    }
    case "doc_html": {
      // the /doc/[id] view as a self-contained page (no view is logged, unlike /sign)
      office(me);
      const documentId = id(body.documentId, "document")!;
      const [{ data: doc }, { data: cs }] = await Promise.all([
        supabase
          .from("documents")
          .select("*, event:events(name, event_date, client:clients(first_name, last_name))")
          .eq("id", documentId)
          .eq("event_id", eventId)
          .maybeSingle(),
        supabase.from("company_settings").select("company_name, from_email").eq("id", true).maybeSingle(),
      ]);
      if (!doc) throw new HttpError("Document not found.", 404);
      const ev = doc.event as unknown as { name: string; event_date: string | null; client: { first_name: string; last_name: string } | null } | null;
      const clientName = ev?.client ? `${ev.client.first_name} ${ev.client.last_name}`.trim() : null;
      let dateLabel: string | null = null;
      if (ev?.event_date) {
        const [y, m, d] = ev.event_date.split("-").map(Number);
        dateLabel = new Date(y, m - 1, d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      }
      const companyName = cs?.company_name ?? "Xpress Entertainment";
      const signedLine = doc.signed_at ? `Signed by ${doc.signer_name} on ${new Date(doc.signed_at).toLocaleString("en-US")}` : cs?.from_email ?? "";
      const blocks = sanitizeBlocks(doc.blocks)
        .map((b) => `<div class="xdoc-block">${b.html ?? ""}</div>`)
        .join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${esc(appUrl())}/"><style>${XDOC_CSS}</style><style>body{margin:0;background:#e4e4e7}.xdoc-body{padding:24px 20px}.xdoc-header{padding:28px 20px}</style></head><body><div class="xdoc"><header class="xdoc-header"><img src="/logo-dark.png" alt="${esc(companyName)}"><div class="xdoc-kind">${esc(docTypeClientLabel(doc.doc_type))}</div><div class="xdoc-title">${esc(doc.title ?? "")}</div><div class="xdoc-sub">${esc([clientName, dateLabel].filter(Boolean).join(" · "))}</div></header><div class="xdoc-body">${blocks}</div><footer class="xdoc-footer"><span>${esc(companyName)}</span><span>${esc(signedLine)}</span></footer></div></body></html>`;
      return { html, signUrl: `${appUrl()}/sign/${doc.access_token}` };
    }

    default:
      throw new HttpError("Unknown action.");
  }
}
