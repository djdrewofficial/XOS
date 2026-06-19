export type EventStatus = {
  id: string;
  name: string;
  color: string;
  text_color: string;
  is_active: boolean;
  is_booked_group: boolean;
  is_pending_group: boolean;
  is_lost_sale_group: boolean;
  is_leads_group: boolean;
  sort_order: number;
};

export type Client = {
  id: string;
  first_name: string;
  last_name: string;
  organization: string | null;
  cell_phone: string | null;
  email: string | null;
  mailing_address: string | null;
  instagram: string | null;
  tiktok: string | null;
  notes: string | null;
  sms_opt_in: boolean;
  created_at: string;
};

export type Venue = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  travel_fee: number;
  setup_fee: number;
  load_in_details: string | null;
  notes: string | null;
  is_one_time: boolean;
};

export type Package = {
  id: string;
  category_id: string | null;
  name: string;
  default_price: number;
  included_hours: number;
  overtime_hourly: number;
  overtime_half_hourly: number;
  hourly_rate: number;
  is_hourly: boolean;
  deposit_value: number;
  is_active: boolean;
  display_order: number;
};

export type Addon = {
  id: string;
  name: string;
  category: string | null;
  default_price: number;
  is_active: boolean;
};

export type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  permission_tier: "master_admin" | "admin" | "salesperson" | "employee";
  hourly_rate: number | null;
  is_active: boolean;
};

export type XEvent = {
  id: string;
  client_id: string | null;
  event_type_id: string | null;
  status_id: string | null;
  inquiry_source_id: string | null;
  salesperson_id: string | null;
  name: string;
  event_date: string | null;
  setup_time: string | null;
  start_time: string | null;
  end_time: string | null;
  guest_count: number | null;
  venue_id: string | null;
  package_id: string | null;
  package_price_override: number | null;
  package_price_locked?: number | null; // price pinned at assignment — catalog changes never reprice events
  package_version_no?: number | null;
  overtime_fee: number;
  travel_fee: number;
  discount1_label: string | null;
  discount1_amount: number;
  discount2_label: string | null;
  discount2_amount: number;
  deposit_value: number;
  initial_contact_date: string | null;
  contract_sent_date: string | null;
  contract_due_date: string | null;
  contract_signed_date: string | null;
  custom_fields: Record<string, string>;
  internal_notes: string | null;
  hide_financials?: boolean | null; // null = inherit event-type default
  archived_at?: string | null; // non-null = archived: automations stopped, hidden from active lists
  created_at: string;
  // joined
  client?: Client | null;
  status?: EventStatus | null;
  venue?: Venue | null;
  package?: Package | null;
  event_type?: { id: string; name: string } | null;
  salesperson?: Employee | null;
};

export type ScheduledPayment = {
  id: string;
  event_id: string;
  seq: number;
  due_date: string | null;
  amount: number;
  label: string | null;
};

export type Payment = {
  id: string;
  event_id: string | null;
  amount: number;
  method: string;
  paid_at: string;
  status: "approved" | "pending";
  notes: string | null;
  reason?: string | null;
  payer_name?: string | null;
  paypal_capture_id?: string | null;
  processing_fee?: number | null;
  bank_deposit_ref?: string | null;
};

export function money(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function eventTotal(e: XEvent): number {
  // override → price locked at assignment → live catalog price (pre-00030 fallback)
  const pkg = e.package_price_override ?? e.package_price_locked ?? e.package?.default_price ?? 0;
  return Number(pkg) + e.overtime_fee + e.travel_fee - e.discount1_amount - e.discount2_amount;
}
