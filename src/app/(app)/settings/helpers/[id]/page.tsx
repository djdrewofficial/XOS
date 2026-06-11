import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateHelper } from "../actions";
import HelperFormFields, { type HelperDefaults } from "@/components/HelperFormFields";

export const dynamic = "force-dynamic";

type HelperAction = {
  type: string;
  status_id?: string;
  event_type_id?: string;
  inquiry_source_id?: string;
  employee_id?: string;
  role?: string;
  definition_id?: string;
  field?: string;
  value?: string;
  template_id?: string;
  body?: string;
};

export default async function EditHelperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: helper },
    { data: statuses },
    { data: templates },
    { data: allHelpers },
    { data: eventTypes },
    { data: sources },
    { data: employees },
    { data: dateDefs },
  ] = await Promise.all([
    supabase.from("booking_helpers").select("*").eq("id", id).single(),
    supabase.from("event_statuses").select("id, name, color, text_color").eq("is_active", true).order("sort_order"),
    supabase.from("email_templates").select("id, name, group_name").eq("is_active", true).order("group_name"),
    supabase.from("booking_helpers").select("id, title").neq("id", id).order("position"),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("inquiry_sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("employees").select("id, first_name, last_name").eq("is_active", true).order("first_name"),
    supabase.from("custom_date_definitions").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  if (!helper) notFound();

  const actions = (helper.actions ?? []) as HelperAction[];
  const find = (type: string) => actions.find((a) => a.type === type);
  const assignAction = find("assign_employee");

  const defaults: HelperDefaults = {
    title: helper.title,
    button_text: helper.button_text,
    button_bg: helper.button_bg,
    button_fg: helper.button_fg,
    is_active: helper.is_active,
    statusId: find("set_status")?.status_id,
    eventTypeId: find("set_event_type")?.event_type_id,
    eventName: find("set_event_name")?.value,
    inquirySourceId: find("set_inquiry_source")?.inquiry_source_id,
    salespersonId: find("set_salesperson")?.employee_id,
    dates: new Map(actions.filter((a) => a.type === "set_date" && a.field).map((a) => [a.field!, a.value ?? ""])),
    customDates: new Map(
      actions.filter((a) => a.type === "set_custom_date" && a.definition_id).map((a) => [a.definition_id!, a.value ?? ""])
    ),
    templateId: find("send_email")?.template_id,
    note: find("add_note")?.body,
    markNotified: !!find("mark_staff_notified"),
    assignEmployeeId: assignAction?.employee_id,
    assignRole: assignAction?.role,
    visibleStatusIds: new Set((helper.visible_status_ids ?? []) as string[]),
    hideIfPaymentMade: helper.hide_if_payment_made,
    hideIfAlreadyRan: helper.hide_if_already_ran,
    hideIfHelpersRan: new Set((helper.hide_if_helpers_ran ?? []) as string[]),
    requiredFields: new Set((helper.required_fields ?? []) as string[]),
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <Link href="/settings/helpers" className="text-xs font-semibold text-zinc-500 hover:underline">
          ← All Booking Helpers
        </Link>
        <h1 className="page-title mt-1">Edit Booking Helper</h1>
        <p className="text-sm text-zinc-500">{helper.title}</p>
      </div>

      <form action={updateHelper.bind(null, id)} className="card p-6">
        <HelperFormFields
          d={defaults}
          statuses={statuses ?? []}
          templates={templates ?? []}
          eventTypes={eventTypes ?? []}
          sources={sources ?? []}
          employees={(employees ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim() }))}
          dateDefs={dateDefs ?? []}
          otherHelpers={allHelpers ?? []}
        />
        <div className="mt-6 flex gap-2">
          <button className="btn-primary">Save Helper</button>
          <Link href="/settings/helpers" className="btn-ghost px-5 py-2.5 text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
