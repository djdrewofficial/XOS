// Canonical event-name builder. When the office doesn't name an event, weddings
// become "Alex & Sam's Wedding" from the Partner A / Partner B first names. The
// SAME string is the basis for the Google Drive folder + Vibo event later, so
// keep this the single source of truth.

import type { SupabaseClient } from "@supabase/supabase-js";

export type NamingClient = {
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  is_primary?: boolean;
};

export function buildEventName(clients: NamingClient[], eventTypeName?: string | null): string {
  const type = (eventTypeName ?? "").trim();
  const isWedding = /wedding/i.test(type);
  const byRole = (r: string) => clients.find((c) => (c.role ?? "").toLowerCase() === r.toLowerCase());
  const primary = clients.find((c) => c.is_primary) ?? clients[0];

  if (isWedding) {
    const a = byRole("Partner A") ?? primary;
    const b = byRole("Partner B") ?? clients.find((c) => c !== a);
    const af = a?.first_name?.trim();
    const bf = b?.first_name?.trim();
    if (af && bf) return `${af} & ${bf}'s Wedding`;
    if (af) return `${af}'s Wedding`;
  }

  if (primary?.first_name) {
    const full = `${primary.first_name} ${primary.last_name ?? ""}`.trim();
    return type ? `${full} ${type}` : full;
  }
  return "";
}

const NAME_PLACEHOLDERS = new Set(["", "new event", "(unnamed event)", "unnamed"]);

/** Names an event from its clients (e.g. "Alex & Sam's Wedding") — but only when
 *  it's still unnamed/placeholder, so an office-chosen name is never overridden. */
export async function autoNameEvent(supabase: SupabaseClient, eventId: string): Promise<void> {
  const { data: full } = await supabase
    .from("events")
    .select("name, event_type:event_types(name), event_clients(is_primary, role, client:clients(first_name, last_name))")
    .eq("id", eventId)
    .maybeSingle();
  const currentName = (full?.name ?? "").trim();
  if (!NAME_PLACEHOLDERS.has(currentName.toLowerCase())) return;
  const clients: NamingClient[] = ((full?.event_clients ?? []) as { is_primary: boolean; role: string | null; client: { first_name?: string; last_name?: string } | null }[]).map(
    (ec) => ({ first_name: ec.client?.first_name, last_name: ec.client?.last_name, role: ec.role, is_primary: ec.is_primary })
  );
  const typeName = (full?.event_type as { name?: string } | null)?.name ?? null;
  const newName = buildEventName(clients, typeName);
  if (newName) await supabase.from("events").update({ name: newName }).eq("id", eventId);
}
