import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type SearchResult = {
  type: string;
  label: string;
  sublabel?: string;
  href: string;
};

/* Static page/settings index so "payment", "staff", "statuses" etc. find screens, not just records. */
const PAGES: { label: string; href: string; keywords: string }[] = [
  { label: "Dashboard", href: "/", keywords: "home overview" },
  { label: "Events", href: "/events", keywords: "event list calendar" },
  { label: "Add Event", href: "/events/new", keywords: "new event create booking" },
  { label: "Clients", href: "/clients", keywords: "customers contacts" },
  { label: "Documents", href: "/documents", keywords: "contracts quotes invoices templates esign agreement" },
  { label: "Venues", href: "/venues", keywords: "locations halls" },
  { label: "Vendors", href: "/vendors", keywords: "photographers video planners" },
  { label: "Packages", href: "/packages", keywords: "pricing services" },
  { label: "Equipment", href: "/equipment", keywords: "gear inventory systems" },
  { label: "Employees", href: "/employees", keywords: "staff djs team" },
  { label: "Payments", href: "/payments", keywords: "money received income" },
  { label: "General Settings", href: "/settings/general", keywords: "application settings" },
  { label: "Booking Helpers", href: "/settings/helpers", keywords: "automation buttons workflow settings" },
  { label: "Dashboard Layout", href: "/settings/dashboard", keywords: "settings widgets" },
  { label: "Event List Settings", href: "/events?settings=1", keywords: "columns sort appearance settings" },
  { label: "Event Statuses", href: "/settings/statuses", keywords: "status colors booked lead settings" },
  { label: "Staff Settings", href: "/settings/staff", keywords: "employee permissions payroll time off notifications settings" },
  { label: "Payment Settings", href: "/settings/payment-settings", keywords: "payment methods reasons settings" },
  { label: "Expenses Settings", href: "/settings/expenses", keywords: "expense categories settings" },
  { label: "Custom Fields", href: "/settings/custom-fields", keywords: "fields settings" },
  { label: "Email Settings", href: "/settings/email", keywords: "templates mailgun sender identity settings" },
  { label: "Inquiry Sources", href: "/settings/sources", keywords: "lead sources settings" },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ results: [] }, { status: 401 });

  const like = `%${q}%`;
  const lower = q.toLowerCase();

  // Match full names like "Laura Smith" across first_name + last_name (in either
  // order), plus the whole string against the other columns. PostgREST parses
  // the nested and(...) groups inside .or().
  const esc = (s: string) => s.replace(/[%,()]/g, "").trim();
  const parts = q.split(/\s+/).map(esc).filter(Boolean);
  const nameOr = (cols: string[]) => {
    const branches = cols.map((col) => `${col}.ilike.%${esc(q)}%`);
    if (parts.length >= 2) {
      const a = parts[0];
      const b = parts.slice(1).join(" ");
      branches.push(`and(first_name.ilike.%${a}%,last_name.ilike.%${b}%)`);
      branches.push(`and(first_name.ilike.%${b}%,last_name.ilike.%${a}%)`);
    }
    return branches.join(",");
  };

  const pageHits: SearchResult[] = PAGES.filter(
    (p) => p.label.toLowerCase().includes(lower) || p.keywords.includes(lower)
  )
    .slice(0, 5)
    .map((p) => ({ type: "Page", label: p.label, href: p.href }));

  const [clients, events, venues, vendors, employees, packages] = await Promise.all([
    supabase
      .from("clients")
      .select("id, first_name, last_name, email, cell_phone")
      .or(nameOr(["first_name", "last_name", "email", "cell_phone"]))
      .limit(5),
    supabase
      .from("events")
      .select("id, name, event_date, status:event_statuses(name)")
      .is("archived_at", null)
      .ilike("name", like)
      .order("event_date", { ascending: false })
      .limit(5),
    supabase.from("venues").select("id, name, city").ilike("name", like).limit(4),
    supabase.from("vendors").select("id, company_name, category").ilike("company_name", like).limit(4),
    supabase
      .from("employees")
      .select("id, first_name, last_name, permission_tier")
      .or(nameOr(["first_name", "last_name"]))
      .limit(4),
    supabase.from("packages").select("id, name").ilike("name", like).limit(4),
  ]);

  const results: SearchResult[] = [
    ...pageHits,
    ...(clients.data ?? []).map((c) => ({
      type: "Client",
      label: `${c.first_name} ${c.last_name ?? ""}`.trim(),
      sublabel: c.email ?? c.cell_phone ?? undefined,
      href: `/clients/${c.id}`,
    })),
    ...(events.data ?? []).map((e) => ({
      type: "Event",
      label: e.name || "(unnamed event)",
      sublabel: [e.event_date, (e.status as unknown as { name: string } | null)?.name]
        .filter(Boolean)
        .join(" · "),
      href: `/events/${e.id}`,
    })),
    ...(venues.data ?? []).map((v) => ({
      type: "Venue",
      label: v.name,
      sublabel: v.city ?? undefined,
      href: `/venues/${v.id}`,
    })),
    ...(vendors.data ?? []).map((v) => ({
      type: "Vendor",
      label: v.company_name,
      sublabel: v.category ?? undefined,
      href: `/vendors/${v.id}`,
    })),
    ...(employees.data ?? []).map((e) => ({
      type: "Employee",
      label: `${e.first_name} ${e.last_name ?? ""}`.trim(),
      sublabel: e.permission_tier?.replace("_", " "),
      href: `/employees/${e.id}`,
    })),
    ...(packages.data ?? []).map((p) => ({
      type: "Package",
      label: p.name,
      href: `/packages/${p.id}`,
    })),
  ];

  return NextResponse.json({ results: results.slice(0, 25) });
}
