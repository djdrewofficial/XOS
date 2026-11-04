"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import {
  SCHEDULE_TEMPLATE_COLUMNS,
  mapTemplate,
  targetDateFor,
  zonedParts,
  type AnchorDates,
  type TemplateRow,
} from "@/lib/scheduledComms";

type RunSnap = {
  status: string;
  override_subject: string | null;
  override_body_html: string | null;
};

async function actorName(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "system";
  const { data: emp } = await supabase
    .from("employees")
    .select("first_name, last_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (emp) return `${emp.first_name} ${emp.last_name}`.trim();
  return user.email ?? "user";
}

function anchorsOf(event: {
  event_date: string | null;
  booked_date: string | null;
  initial_contact_date: string | null;
  contract_sent_date: string | null;
  contract_due_date: string | null;
  contract_signed_date: string | null;
  quote_sent_date: string | null;
}): AnchorDates {
  return {
    eventDate: event.event_date,
    bookedDate: event.booked_date,
    initialContactDate: event.initial_contact_date,
    contractSentDate: event.contract_sent_date,
    contractDueDate: event.contract_due_date,
    contractSignedDate: event.contract_signed_date,
    quoteSentDate: event.quote_sent_date,
  };
}

async function loadOccurrence(eventId: string, templateId: string, targetDate: string) {
  const supabase = await createClient();
  await requireModule("events", "edit", { mode: "throw", supabase });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authorized.");

  const [{ data: tpl }, { data: event }, { data: settings }, { data: run }] = await Promise.all([
    supabase.from("email_templates").select(SCHEDULE_TEMPLATE_COLUMNS).eq("id", templateId).maybeSingle(),
    supabase
      .from("events")
      .select("name, event_date, booked_date, initial_contact_date, contract_sent_date, contract_due_date, contract_signed_date, quote_sent_date")
      .eq("id", eventId)
      .maybeSingle(),
    supabase.from("company_settings").select("timezone").eq("id", true).maybeSingle(),
    supabase
      .from("scheduled_email_runs")
      .select("status, override_subject, override_body_html")
      .eq("template_id", templateId)
      .eq("event_id", eventId)
      .eq("target_date", targetDate)
      .maybeSingle(),
  ]);
  if (!tpl || !event) throw new Error("That scheduled message is no longer available.");
  const template = mapTemplate(tpl as TemplateRow);
  if (!template) throw new Error("That template is not on a schedule.");
  const name = (template.displayName || template.name || "Untitled").trim();
  const channel = template.isSms ? "text" : "email";
  return {
    supabase,
    userId: user.id,
    actor: await actorName(supabase),
    template,
    label: name,
    channel,
    run: (run as RunSnap | null) ?? null,
    computed: targetDateFor(template, anchorsOf(event)),
    today: zonedParts(new Date(), settings?.timezone || "America/New_York").date,
    targetDate,
    eventId,
    templateId,
  };
}

function assertCurrentDate(ctx: Awaited<ReturnType<typeof loadOccurrence>>) {
  if (!ctx.computed) throw new Error("This event doesn't have the date that template schedules from.");
  if (ctx.computed !== ctx.targetDate) {
    throw new Error("The send date changed. Refresh the page and try again.");
  }
}

async function note(ctx: Awaited<ReturnType<typeof loadOccurrence>>, action: string) {
  await ctx.supabase.from("event_logs").insert({ event_id: ctx.eventId, actor: ctx.actor, action });
  revalidatePath(`/events/${ctx.eventId}`);
}

function terminal(status: string | undefined): boolean {
  return status === "sent" || status === "marked_sent";
}

function throwWrite(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === "23505") throw new Error("This one was just sent. Refresh the page.");
  throw new Error(error.message);
}

export async function skipScheduledComm(eventId: string, templateId: string, targetDate: string) {
  const ctx = await loadOccurrence(eventId, templateId, targetDate);
  assertCurrentDate(ctx);
  if (terminal(ctx.run?.status)) throw new Error("This one already went out.");
  if (ctx.targetDate < ctx.today) throw new Error("That send day has already passed.");
  const stamp = {
    status: "skipped",
    acted_by: ctx.userId,
    acted_by_name: ctx.actor,
    acted_at: new Date().toISOString(),
    sent_at: null,
  };
  const write = ctx.run
    ? ctx.supabase
        .from("scheduled_email_runs")
        .update(stamp)
        .eq("template_id", templateId)
        .eq("event_id", eventId)
        .eq("target_date", targetDate)
    : ctx.supabase.from("scheduled_email_runs").insert({
        template_id: templateId,
        event_id: eventId,
        target_date: targetDate,
        ...stamp,
      });
  const { error } = await write;
  throwWrite(error);
  await note(ctx, `Skipped scheduled ${ctx.channel} "${ctx.label}" (${targetDate})`);
}

export async function undoSkipScheduledComm(eventId: string, templateId: string, targetDate: string) {
  const ctx = await loadOccurrence(eventId, templateId, targetDate);
  if (ctx.run?.status !== "skipped") throw new Error("This isn't skipped.");
  if (ctx.targetDate < ctx.today) throw new Error("That send day has passed, so it can't be turned back on.");
  const hasEdit = ctx.run.override_body_html != null || ctx.run.override_subject != null;
  const { error } = hasEdit
    ? await ctx.supabase
        .from("scheduled_email_runs")
        .update({ status: "pending", acted_by: null, acted_by_name: null, acted_at: null })
        .eq("template_id", templateId)
        .eq("event_id", eventId)
        .eq("target_date", targetDate)
        .eq("status", "skipped")
    : await ctx.supabase
        .from("scheduled_email_runs")
        .delete()
        .eq("template_id", templateId)
        .eq("event_id", eventId)
        .eq("target_date", targetDate)
        .eq("status", "skipped");
  throwWrite(error);
  await note(ctx, `Turned the skip back off for scheduled ${ctx.channel} "${ctx.label}" (${targetDate})`);
}

export async function markScheduledCommSent(eventId: string, templateId: string, targetDate: string) {
  const ctx = await loadOccurrence(eventId, templateId, targetDate);
  if (terminal(ctx.run?.status)) return;
  if (ctx.computed !== ctx.targetDate && !ctx.run) {
    throw new Error("The send date changed. Refresh the page and try again.");
  }
  const stamp = {
    status: "marked_sent",
    acted_by: ctx.userId,
    acted_by_name: ctx.actor,
    acted_at: new Date().toISOString(),
    sent_at: null,
  };
  const { error } = ctx.run
    ? await ctx.supabase
        .from("scheduled_email_runs")
        .update(stamp)
        .eq("template_id", templateId)
        .eq("event_id", eventId)
        .eq("target_date", targetDate)
    : await ctx.supabase.from("scheduled_email_runs").insert({
        template_id: templateId,
        event_id: eventId,
        target_date: targetDate,
        ...stamp,
      });
  throwWrite(error);
  await note(ctx, `Marked scheduled ${ctx.channel} "${ctx.label}" (${targetDate}) as already sent`);
}

export async function saveScheduledCommOverride(
  eventId: string,
  templateId: string,
  targetDate: string,
  formData: FormData,
) {
  const ctx = await loadOccurrence(eventId, templateId, targetDate);
  assertCurrentDate(ctx);
  if (terminal(ctx.run?.status)) throw new Error("This one already went out, so the copy can't be changed.");
  if (ctx.targetDate < ctx.today) throw new Error("That send day has already passed.");
  const body = String(formData.get("body_html") ?? "");
  if (body.trim() === "") throw new Error("Write a message before saving.");
  const subject = String(formData.get("subject") ?? "");
  const raw = formData.get("is_raw_html") === "on";
  const edit = {
    override_subject: ctx.template.isSms ? null : subject,
    override_body_html: body,
    override_is_raw_html: raw,
    edited_by: ctx.userId,
    edited_by_name: ctx.actor,
    edited_at: new Date().toISOString(),
  };
  const { error } = ctx.run
    ? await ctx.supabase
        .from("scheduled_email_runs")
        .update(edit)
        .eq("template_id", templateId)
        .eq("event_id", eventId)
        .eq("target_date", targetDate)
    : await ctx.supabase.from("scheduled_email_runs").insert({
        template_id: templateId,
        event_id: eventId,
        target_date: targetDate,
        status: "pending",
        sent_at: null,
        ...edit,
      });
  throwWrite(error);
  await note(ctx, `Edited scheduled ${ctx.channel} "${ctx.label}" for this event only (${targetDate})`);
}

export async function revertScheduledCommOverride(eventId: string, templateId: string, targetDate: string) {
  const ctx = await loadOccurrence(eventId, templateId, targetDate);
  if (!ctx.run || (ctx.run.override_body_html == null && ctx.run.override_subject == null)) return;
  if (terminal(ctx.run.status)) throw new Error("This one already went out.");
  const cleared = {
    override_subject: null,
    override_body_html: null,
    override_is_raw_html: null,
    edited_by: null,
    edited_by_name: null,
    edited_at: null,
  };
  const { error } =
    ctx.run.status === "pending"
      ? await ctx.supabase
          .from("scheduled_email_runs")
          .delete()
          .eq("template_id", templateId)
          .eq("event_id", eventId)
          .eq("target_date", targetDate)
          .eq("status", "pending")
      : await ctx.supabase
          .from("scheduled_email_runs")
          .update(cleared)
          .eq("template_id", templateId)
          .eq("event_id", eventId)
          .eq("target_date", targetDate);
  throwWrite(error);
  await note(ctx, `Reverted scheduled ${ctx.channel} "${ctx.label}" to the shared template (${targetDate})`);
}
