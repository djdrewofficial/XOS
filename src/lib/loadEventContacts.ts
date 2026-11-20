import type { SupabaseClient } from "@supabase/supabase-js";
import { uniqueContacts, type EventContact } from "@/lib/helperRecipients";

/** Event contacts for recipient pickers (helpers + send-for-signature). */
export async function loadEventContacts(
  admin: SupabaseClient,
  eventId: string,
): Promise<EventContact[]> {
  const [{ data: links }, { data: event }] = await Promise.all([
    admin
      .from("event_clients")
      .select("id, client_id, role, is_primary, is_contract_holder, client:clients(id, first_name, last_name, email, cell_phone)")
      .eq("event_id", eventId),
    admin.from("events").select("client_id").eq("id", eventId).maybeSingle(),
  ]);

  const primaryId = (event?.client_id as string | null) ?? null;
  const rows: EventContact[] = [];

  for (const link of links ?? []) {
    const client = link.client as unknown as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      cell_phone: string | null;
    } | null;
    if (!client?.id) continue;
    rows.push({
      clientId: client.id,
      eventClientId: link.id as string,
      firstName: client.first_name,
      lastName: client.last_name,
      email: client.email,
      phone: client.cell_phone,
      role: (link.role as string | null) ?? null,
      isPrimary: Boolean(link.is_primary) || client.id === primaryId,
      isContractHolder: Boolean(link.is_contract_holder),
    });
  }

  // Rare: events.client_id set but no event_clients row yet.
  if (primaryId && !rows.some((r) => r.clientId === primaryId)) {
    const { data: c } = await admin
      .from("clients")
      .select("id, first_name, last_name, email, cell_phone")
      .eq("id", primaryId)
      .maybeSingle();
    if (c) {
      rows.unshift({
        clientId: c.id,
        eventClientId: null,
        firstName: c.first_name,
        lastName: c.last_name,
        email: c.email,
        phone: c.cell_phone,
        role: null,
        isPrimary: true,
        isContractHolder: false,
      });
    }
  }

  return uniqueContacts(rows);
}
