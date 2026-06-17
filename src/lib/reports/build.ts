import type { SupabaseClient } from "@supabase/supabase-js";
import { money, eventTotal, type XEvent } from "@/lib/types";
import { staffHours, staffCost } from "@/lib/payroll";
import type { ReportDoc } from "@/lib/reportPdf";

/* Server-side aggregation for each report → ReportDoc (PDF model). Mirrors the
   on-screen pages and reuses the same helpers + financial-status gates so the
   exported numbers match the screen. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sumN = (a: number[]) => a.reduce((s, n) => s + n, 0);
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const addonsOf = (ev: Record<string, unknown>) =>
  ((ev.event_addons ?? []) as Array<Record<string, unknown>>).reduce((s, a) => {
    const unit = (a.price_override as number) ?? (a.price_locked as number) ?? (a.addon as { default_price?: number } | null)?.default_price ?? 0;
    return s + Number(a.quantity) * Number(unit);
  }, 0);
const venueSetupOf = (ev: Record<string, unknown>) => Number((ev.venue as { setup_fee?: number } | null)?.setup_fee ?? 0);

// ---------- Received payments ----------
export async function buildReceived(supabase: SupabaseClient, y: number): Promise<ReportDoc> {
  const { data } = await supabase
    .from("payments")
    .select("amount, method, reason, paid_at, status, event:events(name)")
    .eq("status", "approved")
    .gte("paid_at", `${y}-01-01T00:00:00`)
    .lte("paid_at", `${y}-12-31T23:59:59`)
    .order("paid_at", { ascending: false });
  const pays = (data ?? []) as Array<Record<string, unknown>>;
  const monthly = Array(12).fill(0) as number[];
  pays.forEach((p) => (monthly[new Date(p.paid_at as string).getMonth()] += Number(p.amount)));
  const total = sumN(monthly);
  return {
    title: `Payments Received — ${y}`,
    stats: [{ label: `Total ${y} received`, value: money(total) }],
    tables: [
      {
        caption: "By month",
        columns: [{ label: "Month" }, { label: "Total", align: "right" }],
        rows: MONTHS.map((m, i) => [m, money(monthly[i])]),
        foot: ["Total", money(total)],
      },
      {
        caption: "Payments",
        columns: [{ label: "Paid" }, { label: "Event" }, { label: "Method" }, { label: "Reason" }, { label: "Amount", align: "right" }],
        rows: pays.map((p) => [
          new Date(p.paid_at as string).toLocaleDateString(),
          (p.event as { name?: string } | null)?.name ?? "Unassigned",
          (p.method as string) ?? "",
          (p.reason as string) ?? "—",
          money(Number(p.amount)),
        ]),
      },
    ],
  };
}

// ---------- Scheduled payments ----------
export async function buildScheduled(supabase: SupabaseClient, y: number): Promise<ReportDoc> {
  const { data } = await supabase
    .from("scheduled_payments")
    .select("due_date, amount, label, event:events(name, archived_at, client:clients(first_name, last_name), status:event_statuses(name, counts_financial))")
    .gte("due_date", `${y}-01-01`)
    .lte("due_date", `${y}-12-31`)
    .order("due_date");
  const rows = ((data ?? []) as Array<Record<string, unknown>>).filter((r) => {
    const ev = r.event as { archived_at?: string | null; status?: { counts_financial?: boolean } | null } | null;
    return r.due_date && !ev?.archived_at && ev?.status?.counts_financial;
  });
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return {
    title: `Scheduled Payments — ${y}`,
    subtitle: "Statuses that count toward Financials only",
    stats: [{ label: `Total ${y} scheduled`, value: money(total) }, { label: "Payments", value: String(rows.length) }],
    tables: [
      {
        caption: "Scheduled payments",
        columns: [{ label: "Due" }, { label: "Title" }, { label: "Event" }, { label: "Client" }, { label: "Status" }, { label: "Amount", align: "right" }],
        rows: rows.map((r) => {
          const ev = r.event as { name?: string; client?: { first_name?: string; last_name?: string } | null; status?: { name?: string } | null } | null;
          const c = ev?.client;
          return [
            fmtDate(r.due_date as string),
            (r.label as string) || "Payment",
            ev?.name ?? "(unnamed)",
            c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : "—",
            ev?.status?.name ?? "",
            money(Number(r.amount)),
          ];
        }),
        foot: ["", "", "", "", "Total", money(total)],
      },
    ],
  };
}

// ---------- Income & Expense summary ----------
export async function buildSummary(supabase: SupabaseClient, y: number): Promise<ReportDoc> {
  const { data: events } = await supabase
    .from("events")
    .select(
      "event_date, archived_at, package_price_override, package_price_locked, overtime_fee, travel_fee, discount1_amount, discount2_amount, setup_time, start_time, end_time, " +
        "status:event_statuses(counts_financial), package:packages(default_price), venue:venues(setup_fee, travel_minutes), " +
        "event_addons(quantity, price_override, price_locked, addon:addons(default_price)), " +
        "event_staff(pay_type, flat_wage, start_time, end_time, checked_in_at, checked_out_at, employee:employees(hourly_rate)), expenses(amount)"
    )
    .gte("event_date", `${y}-01-01`)
    .lte("event_date", `${y}-12-31`);
  const m = Array.from({ length: 12 }, () => ({ events: 0, income: 0, wages: 0, expenses: 0 }));
  for (const ev of (events ?? []) as unknown as Array<Record<string, unknown>>) {
    if (ev.archived_at || !(ev.status as { counts_financial?: boolean } | null)?.counts_financial || !ev.event_date) continue;
    const mo = new Date(`${ev.event_date as string}T00:00:00`).getMonth();
    const income = eventTotal(ev as unknown as XEvent) + addonsOf(ev) + venueSetupOf(ev);
    const travel = (ev.venue as { travel_minutes?: number | null } | null)?.travel_minutes ?? 0;
    const wages = ((ev.event_staff ?? []) as Array<Record<string, unknown>>).reduce((s, es) => {
      const hrs = staffHours(es, ev, travel, { actual: !!(es.checked_in_at && es.checked_out_at) });
      return s + staffCost(es, es.employee as { hourly_rate?: number | null } | null, hrs);
    }, 0);
    const expenses = ((ev.expenses ?? []) as Array<{ amount: number }>).reduce((s, x) => s + Number(x.amount), 0);
    m[mo].events += 1;
    m[mo].income += income;
    m[mo].wages += wages;
    m[mo].expenses += expenses;
  }
  const tot = m.reduce((a, r) => ({ events: a.events + r.events, income: a.income + r.income, wages: a.wages + r.wages, expenses: a.expenses + r.expenses }), { events: 0, income: 0, wages: 0, expenses: 0 });
  return {
    title: `Income & Expense — ${y}`,
    subtitle: "By event date · Financials-counting statuses",
    tables: [
      {
        columns: [{ label: "Month" }, { label: "Events", align: "right" }, { label: "Event Income", align: "right" }, { label: "Wages", align: "right" }, { label: "Expenses", align: "right" }, { label: "Profit", align: "right" }],
        rows: m.map((r, i) => [MONTHS[i], String(r.events), money(r.income), money(r.wages), money(r.expenses), money(r.income - r.wages - r.expenses)]),
        foot: ["Total", String(tot.events), money(tot.income), money(tot.wages), money(tot.expenses), money(tot.income - tot.wages - tot.expenses)],
      },
    ],
  };
}

// ---------- Monthly breakdown (year × month) ----------
export async function buildMonthly(supabase: SupabaseClient): Promise<ReportDoc> {
  const { data: events } = await supabase
    .from("events")
    .select(
      "event_date, archived_at, package_price_override, package_price_locked, overtime_fee, travel_fee, discount1_amount, discount2_amount, " +
        "status:event_statuses(counts_financial), package:packages(default_price), venue:venues(setup_fee), event_addons(quantity, price_override, price_locked, addon:addons(default_price))"
    )
    .not("event_date", "is", null)
    .limit(5000);
  const byYear = new Map<number, number[]>();
  for (const ev of (events ?? []) as unknown as Array<Record<string, unknown>>) {
    if (ev.archived_at || !(ev.status as { counts_financial?: boolean } | null)?.counts_financial) continue;
    const d = new Date(`${ev.event_date as string}T00:00:00`);
    if (!byYear.has(d.getFullYear())) byYear.set(d.getFullYear(), Array(12).fill(0));
    byYear.get(d.getFullYear())![d.getMonth()] += eventTotal(ev as unknown as XEvent) + addonsOf(ev) + venueSetupOf(ev);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const monthTot = Array.from({ length: 12 }, (_, i) => years.reduce((s, y) => s + byYear.get(y)![i], 0));
  return {
    title: "Monthly Breakdown",
    subtitle: "Event income by event date · Financials-counting statuses",
    tables: [
      {
        columns: [{ label: "Year" }, ...MONTHS.map((mm) => ({ label: mm, align: "right" as const })), { label: "Total", align: "right" as const }],
        rows: years.map((y) => [String(y), ...byYear.get(y)!.map((n) => money(n)), money(sumN(byYear.get(y)!))]),
        foot: ["Total", ...monthTot.map((n) => money(n)), money(sumN(monthTot))],
      },
    ],
  };
}

// ---------- Outstanding balances ----------
export async function buildOutstanding(supabase: SupabaseClient): Promise<ReportDoc> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: events } = await supabase
    .from("events")
    .select(
      "name, event_date, archived_at, package_price_override, package_price_locked, overtime_fee, travel_fee, discount1_amount, discount2_amount, " +
        "status:event_statuses(name, counts_financial), client:clients(first_name, last_name), package:packages(default_price), venue:venues(setup_fee), " +
        "event_addons(quantity, price_override, price_locked, addon:addons(default_price)), payments(amount, status, scheduled_payment_id), scheduled_payments(id, seq, due_date, amount)"
    )
    .limit(5000);
  type R = { name: string; client: string; date: string | null; total: number; paid: number; balance: number; overdue: number; status: string };
  const rows: R[] = [];
  for (const ev of (events ?? []) as unknown as Array<Record<string, unknown>>) {
    if (ev.archived_at || !(ev.status as { counts_financial?: boolean } | null)?.counts_financial) continue;
    const total = eventTotal(ev as unknown as XEvent) + addonsOf(ev) + venueSetupOf(ev);
    const pays = ((ev.payments ?? []) as Array<{ amount: number; status: string; scheduled_payment_id: string | null }>).filter((p) => p.status === "approved");
    const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
    const balance = Math.round((total - paid) * 100) / 100;
    if (balance <= 0.01) continue;
    const taken = new Set(pays.map((p) => p.scheduled_payment_id).filter(Boolean));
    const sched = ((ev.scheduled_payments ?? []) as Array<{ id: string; seq: number; due_date: string | null }>).sort((a, b) => a.seq - b.seq);
    const next = sched.find((s) => !taken.has(s.id));
    const overdue = next?.due_date && next.due_date < today ? Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${next.due_date}T00:00:00`).getTime()) / 86_400_000) : 0;
    const c = ev.client as { first_name?: string; last_name?: string } | null;
    rows.push({
      name: (ev.name as string) || "(unnamed)",
      client: c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : "—",
      date: (ev.event_date as string) ?? null,
      total,
      paid,
      balance,
      overdue,
      status: (ev.status as { name?: string } | null)?.name ?? "",
    });
  }
  rows.sort((a, b) => (b.overdue !== a.overdue ? b.overdue - a.overdue : (a.date ?? "9999") < (b.date ?? "9999") ? -1 : 1));
  const totalOut = rows.reduce((s, r) => s + r.balance, 0);
  const overdueOut = rows.filter((r) => r.overdue > 0).reduce((s, r) => s + r.balance, 0);
  return {
    title: "Outstanding Balances",
    stats: [
      { label: "Total Outstanding", value: money(totalOut) },
      { label: "Overdue", value: money(overdueOut) },
      { label: "Events Owing", value: String(rows.length) },
    ],
    tables: [
      {
        columns: [{ label: "Event" }, { label: "Client" }, { label: "Event Date" }, { label: "Total", align: "right" }, { label: "Paid", align: "right" }, { label: "Balance", align: "right" }, { label: "Aging" }],
        rows: rows.map((r) => [`${r.name} (${r.status})`, r.client, fmtDate(r.date), money(r.total), money(r.paid), money(r.balance), r.overdue > 0 ? `Overdue ${r.overdue}d` : "current"]),
        foot: ["", "", "", "", "Total", money(totalOut), ""],
      },
    ],
  };
}

// ---------- Sales & commissions ----------
export async function buildCommissions(supabase: SupabaseClient, y: number): Promise<ReportDoc> {
  const { data: events } = await supabase
    .from("events")
    .select(
      "event_date, salesperson_id, archived_at, package_price_override, package_price_locked, overtime_fee, travel_fee, discount1_amount, discount2_amount, " +
        "status:event_statuses(counts_financial), package:packages(default_price), venue:venues(setup_fee), event_addons(quantity, price_override, price_locked, addon:addons(default_price)), " +
        "salesperson:employees(id, first_name, last_name, sales_commission_pct, addon_commission_pct)"
    )
    .gte("event_date", `${y}-01-01`)
    .lte("event_date", `${y}-12-31`)
    .limit(5000);
  const map = new Map<string, { name: string; sPct: number; aPct: number; events: number; base: number; addon: number }>();
  for (const ev of (events ?? []) as unknown as Array<Record<string, unknown>>) {
    if (ev.archived_at || !(ev.status as { counts_financial?: boolean } | null)?.counts_financial) continue;
    const sp = ev.salesperson as { id?: string; first_name?: string; last_name?: string; sales_commission_pct?: number; addon_commission_pct?: number } | null;
    const key = sp?.id ?? "unassigned";
    if (!map.has(key)) map.set(key, { name: sp ? `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim() || "—" : "Unassigned", sPct: Number(sp?.sales_commission_pct ?? 0), aPct: Number(sp?.addon_commission_pct ?? 0), events: 0, base: 0, addon: 0 });
    const g = map.get(key)!;
    g.events += 1;
    g.base += eventTotal(ev as unknown as XEvent) + venueSetupOf(ev);
    g.addon += addonsOf(ev);
  }
  const people = [...map.values()].sort((a, b) => b.base + b.addon - (a.base + a.addon));
  const sComm = (p: typeof people[number]) => (p.base * p.sPct) / 100;
  const aComm = (p: typeof people[number]) => (p.addon * p.aPct) / 100;
  const tot = people.reduce((s, p) => ({ events: s.events + p.events, sales: s.sales + p.base + p.addon, s: s.s + sComm(p), a: s.a + aComm(p) }), { events: 0, sales: 0, s: 0, a: 0 });
  return {
    title: `Sales & Commissions — ${y}`,
    subtitle: "Booked (Financials-counting) events by event date",
    tables: [
      {
        columns: [{ label: "Salesperson" }, { label: "Events", align: "right" }, { label: "Sales", align: "right" }, { label: "Sales Comm.", align: "right" }, { label: "Add-on Comm.", align: "right" }, { label: "Total Comm.", align: "right" }],
        rows: people.map((p) => [p.name, String(p.events), money(p.base + p.addon), money(sComm(p)), money(aComm(p)), money(sComm(p) + aComm(p))]),
        foot: ["Total", String(tot.events), money(tot.sales), money(tot.s), money(tot.a), money(tot.s + tot.a)],
      },
    ],
  };
}

// ---------- Leads & Sales ----------
export async function buildLeads(supabase: SupabaseClient, params: { year: number; type?: string | null; status?: string | null }): Promise<ReportDoc> {
  const { year: y, type, status } = params;
  const { data } = await supabase
    .from("events")
    .select(
      "event_date, initial_contact_date, contract_signed_date, booked_date, created_at, event_type_id, status_id, " +
        "event_type:event_types(name), status:event_statuses(is_booked_group), inquiry_source:inquiry_sources(name)"
    )
    .limit(10000);
  type E = Record<string, unknown> & { status?: { is_booked_group?: boolean } | null };
  const all = (data ?? []) as unknown as E[];
  const evs = all.filter((e) => (!type || e.event_type_id === type) && (!status || e.status_id === status));
  const leadDate = (e: E) => (e.initial_contact_date as string | null) ?? (e.created_at ? (e.created_at as string).slice(0, 10) : null);
  const bookedDate = (e: E) => (e.contract_signed_date as string | null) ?? (e.booked_date as string | null) ?? null;
  const isBooked = (e: E) => !!e.status?.is_booked_group;
  const days = (a: string, b: string) => (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000;
  const yr = (iso: string | null) => (iso ? Number(iso.slice(0, 4)) : null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0);

  const byYear = new Map<number, number[]>();
  for (const e of evs) {
    const ld = leadDate(e);
    if (!ld) continue;
    if (!byYear.has(yr(ld)!)) byYear.set(yr(ld)!, Array(12).fill(0));
    byYear.get(yr(ld)!)![Number(ld.slice(5, 7)) - 1] += 1;
  }
  const gYears = [...byYear.keys()].sort((a, b) => a - b);
  const leads = evs.filter((e) => yr(leadDate(e)) === y);
  const booked = evs.filter((e) => isBooked(e) && yr(bookedDate(e)) === y);
  const leadTime = booked.filter((e) => e.event_date && bookedDate(e)).map((e) => days(bookedDate(e)!, e.event_date as string));
  const ttb = booked.filter((e) => bookedDate(e) && leadDate(e)).map((e) => days(leadDate(e)!, bookedDate(e)!));

  const src = new Map<string, { leads: number; booked: number }>();
  for (const e of leads) {
    const n = (e.inquiry_source as { name?: string } | null)?.name ?? "— none —";
    if (!src.has(n)) src.set(n, { leads: 0, booked: 0 });
    src.get(n)!.leads += 1;
    if (isBooked(e)) src.get(n)!.booked += 1;
  }
  const types = new Map<string, { count: number; lead: number[]; ttb: number[] }>();
  for (const e of booked) {
    const n = (e.event_type as { name?: string } | null)?.name ?? "— none —";
    if (!types.has(n)) types.set(n, { count: 0, lead: [], ttb: [] });
    const t = types.get(n)!;
    t.count += 1;
    if (e.event_date && bookedDate(e)) t.lead.push(days(bookedDate(e)!, e.event_date as string));
    if (bookedDate(e) && leadDate(e)) t.ttb.push(days(leadDate(e)!, bookedDate(e)!));
  }
  const mo = (d: number) => `${(d / 30.44).toFixed(1)} mo`;
  return {
    title: `Leads & Sales — ${y}`,
    stats: [
      { label: "Leads", value: String(leads.length) },
      { label: "Booked", value: String(booked.length) },
      { label: "Conversion", value: `${leads.length ? Math.round((booked.length / leads.length) * 100) : 0}%` },
      { label: "Avg lead time", value: leadTime.length ? mo(avg(leadTime)) : "—" },
      { label: "Avg time to book", value: ttb.length ? `${Math.round(avg(ttb))}d` : "—" },
    ],
    tables: [
      {
        caption: "Leads per Month",
        columns: [{ label: "Year" }, ...MONTHS.map((mm) => ({ label: mm, align: "right" as const })), { label: "Total", align: "right" as const }],
        rows: gYears.map((y2) => [String(y2), ...byYear.get(y2)!.map((n) => String(n || "")), String(sumN(byYear.get(y2)!))]),
      },
      {
        caption: `Inquiry Sources — ${y}`,
        columns: [{ label: "Source" }, { label: "Leads", align: "right" }, { label: "Booked", align: "right" }, { label: "Conversion", align: "right" }],
        rows: [...src.entries()].sort((a, b) => b[1].leads - a[1].leads).map(([n, v]) => [n, String(v.leads), String(v.booked), v.leads ? `${Math.round((v.booked / v.leads) * 100)}%` : "—"]),
      },
      {
        caption: `Booking Lead Time by Type — ${y}`,
        columns: [{ label: "Event Type" }, { label: "Booked", align: "right" }, { label: "Avg Lead Time", align: "right" }, { label: "Time to Book", align: "right" }],
        rows: [...types.entries()].sort((a, b) => b[1].count - a[1].count).map(([n, v]) => [n, String(v.count), v.lead.length ? mo(avg(v.lead)) : "—", v.ttb.length ? `${Math.round(avg(v.ttb))}d` : "—"]),
      },
    ],
  };
}
