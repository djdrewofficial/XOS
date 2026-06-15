// Human-readable summary of what a booking helper will DO — shown in the
// confirmation dialog before the office runs a helper manually.

export type HelperAction = {
  type: string;
  status_id?: string;
  employee_id?: string;
  role?: string;
  definition_id?: string;
  field?: string;
  value?: string;
  template_id?: string;
  to?: string;
  from?: string;
  audience?: string;
  body?: string;
  minutes?: string;
  helper_id?: string;
};

export type HelperLookups = {
  emailTemplates?: Record<string, string>;
  smsTemplates?: Record<string, string>;
  statuses?: Record<string, string>;
  employees?: Record<string, string>;
  dateDefs?: Record<string, string>;
};

const FIELD_LABELS: Record<string, string> = {
  initial_contact_date: "Initial Contact Date",
  contract_sent_date: "Contract Sent Date",
  contract_due_date: "Contract Due Date",
  booked_date: "Date Booked",
  contract_signed_date: "Contract Signed",
  quote_sent_date: "Quote Sent",
  setup_time: "Setup Time",
  start_time: "Start Time",
  end_time: "End Time",
};

function tmpl(map: Record<string, string> | undefined, id?: string): string {
  return (id && map?.[id]) || "template";
}

/** Returns a list of plain-English action descriptions for a helper. */
export function summarizeHelperActions(actions: HelperAction[], lk: HelperLookups = {}): string[] {
  const out: string[] = [];
  for (const a of actions ?? []) {
    switch (a.type) {
      case "send_email":
        out.push(`Email ${a.to === "custom" ? "(custom address)" : "to client"}: ${tmpl(lk.emailTemplates, a.template_id)}`);
        break;
      case "send_email_staff":
        out.push(`Email to employees: ${tmpl(lk.emailTemplates, a.template_id)}`);
        break;
      case "send_sms":
        out.push(`SMS ${a.to === "custom" ? "(custom number)" : "to client"}: ${a.template_id ? tmpl(lk.smsTemplates, a.template_id) : "text message"}`);
        break;
      case "send_sms_staff":
        out.push(`SMS to employees: ${a.template_id ? tmpl(lk.smsTemplates, a.template_id) : "text message"}`);
        break;
      case "set_status":
        out.push(`Change status → ${(a.status_id && lk.statuses?.[a.status_id]) || "new status"}`);
        break;
      case "assign_employee":
        out.push(`Assign ${(a.employee_id && lk.employees?.[a.employee_id]) || "employee"}${a.role ? ` as ${a.role}` : ""}`);
        break;
      case "mark_notified":
        out.push("Mark all employees as notified");
        break;
      case "set_date":
        out.push(`Set ${FIELD_LABELS[a.field ?? ""] ?? a.field ?? "date"}${a.value ? ` → ${a.value}` : ""}`);
        break;
      case "set_time":
        out.push(`Set ${FIELD_LABELS[a.field ?? ""] ?? a.field ?? "time"}${a.value ? ` → ${a.value}` : ""}`);
        break;
      case "set_custom_date":
        out.push(`Set ${(a.definition_id && lk.dateDefs?.[a.definition_id]) || "custom date"}${a.value ? ` → ${a.value}` : ""}`);
        break;
      case "set_event_type":
        out.push("Set event type");
        break;
      case "set_inquiry_source":
        out.push("Set inquiry source");
        break;
      case "run_helper":
        out.push("Run a follow-up helper");
        break;
      default:
        if (a.type) out.push(a.type.replace(/_/g, " "));
    }
  }
  return out;
}
