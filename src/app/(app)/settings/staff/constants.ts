/* DJEP Employee Settings parity — permission keys, defaults, and option lists
   shared by the Staff Settings page and its server actions. */

// [key, label, default]
export const PERM_SECTIONS = [
  ["client", "Client", true],
  ["booking", "Booking", true],
  ["venue", "Venue", true],
  ["resources", "Resources", true],
  ["email", "Email", true],
  ["planning", "Planning", true],
  ["details", "Details", true],
  ["services", "Services (Package / Addon details)", true],
  ["staff", "Staff", true],
  ["contact_manager", "Contact Manager", true],
  ["documents", "Documents", true],
] as const;

// grouped view permissions: [key, label, default]
export const PERM_VIEW_CLIENT = [["client_notes", "Client Notes", true]] as const;

export const PERM_VIEW_BOOKING = [
  ["inquiry_source", "Inquiry Source", true],
  ["booking_comments", "Booking Comments", false],
  ["booking_process_dates", "Booking Process Dates", true],
  ["next_action", "Next Action", true],
] as const;

export const PERM_VIEW_EMPLOYEES = [
  ["emp_names", "Names", true],
  ["emp_email", "Email Address", true],
  ["emp_home_phone", "Home Phone", true],
  ["emp_cell_phone", "Cell Phone", true],
  ["limit_primary_only", "Limit Access To Primary Employee Only", false],
] as const;

export const PERM_VIEW_OTHER = [
  ["package", "Package", true],
  ["addons", "Addons", true],
  ["their_wage", "Their Wage", true],
  ["related_files", "Related Files", false],
  ["post_event_notes", "Post Event Notes", false],
  ["contract_notes", "Contract Notes", true],
] as const;

export const PERM_VIEW_ALL = [
  ...PERM_VIEW_CLIENT,
  ...PERM_VIEW_BOOKING,
  ...PERM_VIEW_EMPLOYEES,
  ...PERM_VIEW_OTHER,
] as const;

export const PERM_NOTES = [
  ["add_post_event_notes", "Post Event Notes", false],
  ["edit_client_notes", "Client Notes", false],
  ["edit_booking_comments", "Booking Comments", false],
] as const;

// employee-portal self-service fields: [key, label, defaultView, defaultEdit]
export const PORTAL_FIELDS = [
  ["name", "Name", true, true],
  ["stage_name", "Stage Name", true, true],
  ["cell_phone", "Cell Phone", true, true],
  ["home_phone", "Home Phone", true, true],
  ["work_phone", "Work Phone", true, true],
  ["email", "Email", true, true],
  ["website", "Website", true, true],
  ["profile_image", "Profile Image", true, false],
  ["address", "Address", false, false],
  ["emergency_contact", "Emergency Contact", true, true],
  ["birthday", "Birthday", true, true],
  ["anniversary", "Anniversary", false, false],
  ["biography", "Biography", false, false],
  ["notes", "Notes", false, false],
] as const;

export const PAYROLL_EXPORT_FIELDS = [
  ["event_id", "Event ID"],
  ["event_type", "Event Type"],
  ["event_date", "Event Date"],
  ["client_name", "Client Name"],
  ["employee_name", "Employee Name"],
  ["employee_id", "Employee ID"],
  ["employee_role", "Employee Role"],
  ["start_time", "Start Time"],
  ["end_time", "End Time"],
  ["hours", "Hours"],
  ["wage", "Wage"],
  ["venue_name", "Venue Name"],
] as const;

export type StaffSettings = {
  id: boolean;
  feat_time_off: boolean;
  feat_confirm_events: boolean;
  feat_decline_events: boolean;
  feat_check_in_out: boolean;
  feat_timesheets: boolean;
  feat_wage_report: boolean;
  feat_available_events: boolean;
  feat_event_count: boolean;
  time_off_mode: "any" | "advance_notice" | "none";
  time_off_advance_days: number | null;
  time_off_allow_delete: boolean;
  time_off_auto_approve: boolean;
  time_off_terminology: string;
  decline_requires_reason: boolean;
  show_past_event_count: boolean;
  show_upcoming_event_count: boolean;
  access_status_ids: string[] | null;
  access_days_before: number | null;
  access_days_after: number | null;
  perm_sections: Record<string, boolean>;
  perm_view: Record<string, boolean>;
  perm_notes: Record<string, boolean>;
  portal_fields: Record<string, { view: boolean; edit: boolean }>;
  notify_request_event: string | null;
  notify_check_in: string | null;
  notify_check_out: string | null;
  notify_timesheet: string | null;
  notify_time_off: string | null;
  notify_confirm_decline: string | null;
  notify_confirm_also_salesperson: boolean;
  assign_employee_template_id: string | null;
  assign_salesperson_template_id: string | null;
  assign_mark_notified: boolean;
  notif_exclude_employee_ids: string[] | null;
  notif_exclude_status_ids: string[] | null;
  payroll_sort_day: string;
  payroll_sort_event: string;
  payroll_name_format: string;
  payroll_start_offset_days: number;
  payroll_end_offset_days: number;
  payroll_export_fields: string[];
  availability_sort: string;
};
