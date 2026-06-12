/* Dashboard widget registry — the single list of widgets the layout builder can
   place. Add new entries here as features come online; the builder and the
   dashboard pick them up automatically. Safe to import from client and server. */

export type WidgetSize = "full" | "half";

export type LayoutItem = { id: string; size: WidgetSize };

export type WidgetDef = {
  id: string;
  name: string;
  description: string;
  defaultSize: WidgetSize;
};

export const WIDGETS: WidgetDef[] = [
  {
    id: "stat_cards",
    name: "Monthly Stats",
    description: "Leads, lost sales, booked, and inquiries for the current month",
    defaultSize: "full",
  },
  {
    id: "calendar",
    name: "Month Calendar",
    description: "Full month grid with events, holidays, and approved time off",
    defaultSize: "full",
  },
  {
    id: "upcoming_events",
    name: "Upcoming Events",
    description: "The next events on the books",
    defaultSize: "half",
  },
  {
    id: "recent_payments",
    name: "Recent Payments",
    description: "Latest payments received",
    defaultSize: "half",
  },
  {
    id: "recent_notifications",
    name: "Notifications",
    description: "Latest system notifications",
    defaultSize: "half",
  },
  {
    id: "quick_actions",
    name: "Quick Actions",
    description: "One-click shortcuts: add event, clients, payments",
    defaultSize: "half",
  },
  {
    id: "my_upcoming_events",
    name: "My Upcoming Events",
    description: "Events the signed-in employee is assigned to",
    defaultSize: "half",
  },
];

export const WIDGET_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

export const ROLES = [
  ["master_admin", "Master Admin"],
  ["admin", "Admin"],
  ["salesperson", "Salesperson"],
  ["employee", "Employee"],
] as const;

export type Role = (typeof ROLES)[number][0];

/* fallback layouts (also seeded into dashboard_layouts by migration 00033) */
export const DEFAULT_LAYOUTS: Record<Role, LayoutItem[]> = {
  master_admin: [
    { id: "stat_cards", size: "full" },
    { id: "calendar", size: "full" },
    { id: "upcoming_events", size: "half" },
    { id: "recent_payments", size: "half" },
  ],
  admin: [
    { id: "stat_cards", size: "full" },
    { id: "calendar", size: "full" },
    { id: "upcoming_events", size: "half" },
    { id: "recent_payments", size: "half" },
  ],
  salesperson: [
    { id: "stat_cards", size: "full" },
    { id: "calendar", size: "full" },
    { id: "upcoming_events", size: "half" },
    { id: "quick_actions", size: "half" },
  ],
  employee: [
    { id: "my_upcoming_events", size: "full" },
    { id: "calendar", size: "full" },
  ],
};

export function sanitizeLayout(value: unknown): LayoutItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: LayoutItem[] = [];
  for (const item of value) {
    const id = typeof item?.id === "string" ? item.id : null;
    if (!id || seen.has(id) || !WIDGET_BY_ID.has(id)) continue;
    seen.add(id);
    out.push({ id, size: item?.size === "half" ? "half" : "full" });
  }
  return out;
}
