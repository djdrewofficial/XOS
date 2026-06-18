/* Read-only tools the XOS Assistant may call. Server-only. These deliberately
   expose ONLY non-personal event data — no client names, contacts, or addresses,
   and no venue names for one-time/home events (those can be a person's name). */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDef } from "@/lib/openai";

export const ASSISTANT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Check whether a specific calendar date is open or booked. Use for questions like 'are we free on January 15 2027?' or 'what's on March 3?'. Returns whether the date is open plus any events that day (no client info).",
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "The date in YYYY-MM-DD format." } },
        required: ["date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_events",
      description:
        "List events between two dates (inclusive) — for browsing the calendar or counting events in a period. Returns date, time, type, status, and venue region. No client personal information.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "Start date YYYY-MM-DD." },
          end_date: { type: "string", description: "End date YYYY-MM-DD." },
          status: { type: "string", description: "Optional exact status name to filter by (e.g. 'Booked')." },
        },
        required: ["start_date", "end_date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_pricing",
      description:
        "Get the CURRENT price of an XOS package or add-on — the single source of truth for pricing. Use this for ANY pricing/cost/'how much' question instead of quoting from memory. Searches the live catalog by name. Returns matching items with their current price; if nothing matches it returns the full catalog so you can help.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Item or package name, e.g. 'Dancing on the Clouds', 'uplighting', or 'Xpress package'. Use an empty string to list everything." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

const STOP = new Set([
  "package", "packages", "addon", "addons", "add-on", "extra", "extras", "price", "pricing",
  "prices", "cost", "costs", "much", "how", "the", "for", "our", "with", "and", "what", "does",
  "your", "have", "this", "that", "rental", "experience",
]);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

type EventRow = {
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  event_type: { name: string } | null;
  status: { name: string; counts_availability: boolean } | null;
  venue: { name: string | null; city: string | null; state: string | null; is_one_time: boolean } | null;
};

const SELECT =
  "event_date, start_time, end_time, event_type:event_types(name), status:event_statuses(name, counts_availability), venue:venues(name, city, state, is_one_time)";

/** Strip to non-personal fields; hide venue name for one-time/home venues. */
function sanitize(e: EventRow) {
  const v = e.venue;
  const venue = v ? (v.is_one_time ? { city: v.city, state: v.state } : { name: v.name, city: v.city, state: v.state }) : null;
  return {
    date: e.event_date,
    start_time: e.start_time,
    end_time: e.end_time,
    type: e.event_type?.name ?? null,
    status: e.status?.name ?? null,
    blocks_availability: !!e.status?.counts_availability,
    venue,
  };
}

export async function runAssistantTool(
  name: string,
  args: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<unknown> {
  if (name === "check_availability") {
    const date = String(args.date ?? "");
    if (!ISO.test(date)) return { error: "Provide the date as YYYY-MM-DD." };
    const { data, error } = await supabase
      .from("events")
      .select(SELECT)
      .eq("event_date", date)
      .is("archived_at", null);
    if (error) return { error: error.message };
    const events = ((data ?? []) as unknown as EventRow[]).map(sanitize);
    const blocking = events.filter((e) => e.blocks_availability);
    return {
      date,
      open: blocking.length === 0,
      booked_count: blocking.length,
      tentative_count: events.length - blocking.length,
      events,
      note:
        blocking.length === 0
          ? "No availability-blocking events on this date — it is open."
          : "There is at least one booked/availability-blocking event on this date.",
    };
  }

  if (name === "list_events") {
    const start = String(args.start_date ?? "");
    const end = String(args.end_date ?? "");
    if (!ISO.test(start) || !ISO.test(end)) return { error: "Provide start_date and end_date as YYYY-MM-DD." };
    let q = supabase
      .from("events")
      .select(SELECT)
      .gte("event_date", start)
      .lte("event_date", end)
      .is("archived_at", null)
      .order("event_date")
      .limit(150);
    if (args.status) q = q.eq("event_statuses.name", String(args.status));
    const { data, error } = await q;
    if (error) return { error: error.message };
    const rows = (data ?? []) as unknown as EventRow[];
    const events = rows.map(sanitize).filter((e) => !args.status || e.status === args.status);
    return { start, end, count: events.length, truncated: rows.length >= 150, events };
  }

  if (name === "lookup_pricing") {
    return lookupPricing(supabase, String(args.query ?? ""));
  }

  return { error: `Unknown tool: ${name}` };
}

type AddonRow = { name: string; client_facing_name: string | null; default_price: string | number };
type PackageRow = AddonRow & {
  included_hours: number | null; is_hourly: boolean | null; hourly_rate: string | number | null;
  overtime_hourly: string | number | null; deposit_value: string | number | null;
};

async function lookupPricing(supabase: SupabaseClient, query: string) {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5));
  const [{ data: addons }, { data: packages }] = await Promise.all([
    supabase.from("addons").select("name, client_facing_name, default_price").eq("is_active", true).order("display_order"),
    supabase
      .from("packages")
      .select("name, client_facing_name, default_price, included_hours, is_hourly, hourly_rate, overtime_hourly, deposit_value")
      .eq("is_active", true)
      .order("display_order"),
  ]);

  const hit = (r: AddonRow) => {
    const n = `${r.name} ${r.client_facing_name ?? ""}`.toLowerCase();
    return tokens.length === 0 ? true : tokens.some((t) => n.includes(t));
  };
  const money = (v: string | number | null) => (v == null ? null : Number(v));
  const addonOut = (r: AddonRow) => ({ kind: "add-on", name: r.name, price: money(r.default_price) });
  const pkgOut = (r: PackageRow) => ({
    kind: "package", name: r.name, price: money(r.default_price),
    included_hours: r.included_hours ?? undefined,
    hourly: r.is_hourly ? money(r.hourly_rate) : undefined,
    overtime_per_hour: money(r.overtime_hourly) ?? undefined,
    deposit: money(r.deposit_value) ?? undefined,
  });

  const matchedAddons = ((addons ?? []) as AddonRow[]).filter(hit).map(addonOut);
  const matchedPackages = ((packages ?? []) as PackageRow[]).filter(hit).map(pkgOut);
  const matches = [...matchedPackages, ...matchedAddons];

  if (matches.length === 0) {
    return {
      matches: [],
      note: "No catalog item matched — its price may not be set up in XOS yet. Here is the full current catalog.",
      all_items: [
        ...((packages ?? []) as PackageRow[]).map(pkgOut),
        ...((addons ?? []) as AddonRow[]).map(addonOut),
      ],
    };
  }
  return { matches, note: "Prices are the current XOS defaults (USD); a specific event may differ if a custom price was set on that booking." };
}
