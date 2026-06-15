// Canonical event-name builder. When the office doesn't name an event, weddings
// become "Alex & Sam's Wedding" from the Partner A / Partner B first names. The
// SAME string is the basis for the Google Drive folder + Vibo event later, so
// keep this the single source of truth.

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
