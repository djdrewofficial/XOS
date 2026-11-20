import type { SupabaseClient } from "@supabase/supabase-js";

/** One event_clients row as returned by MCP events_get (for set_contract_holder / recipients). */
export type EventClientMembership = {
  event_client_id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  is_primary: boolean;
  is_contract_holder: boolean;
  has_email: boolean;
  has_phone: boolean;
};

type EventClientJoinRow = {
  id?: string | null;
  client_id?: string | null;
  role?: string | null;
  is_primary?: boolean | null;
  is_contract_holder?: boolean | null;
  client?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    cell_phone?: string | null;
  } | null;
};

function nonEmpty(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

/** Map event_clients (+ nested client) rows into the events_get memberships shape. */
export function mapEventClientMemberships(rows: unknown): EventClientMembership[] {
  if (!Array.isArray(rows)) return [];
  const out: EventClientMembership[] = [];
  for (const raw of rows) {
    const row = raw as EventClientJoinRow;
    const eventClientId = typeof row.id === "string" ? row.id : null;
    const clientId = typeof row.client_id === "string" ? row.client_id : null;
    if (!eventClientId || !clientId) continue;
    const client = row.client ?? null;
    out.push({
      event_client_id: eventClientId,
      client_id: clientId,
      first_name: client?.first_name ?? null,
      last_name: client?.last_name ?? null,
      role: row.role ?? null,
      is_primary: row.is_primary === true,
      is_contract_holder: row.is_contract_holder === true,
      has_email: nonEmpty(client?.email),
      has_phone: nonEmpty(client?.cell_phone),
    });
  }
  return out;
}

/** Load memberships for events_get so agents can pass event_client_id to set_contract_holder. */
export async function listEventClientMemberships(
  admin: SupabaseClient,
  eventId: string,
): Promise<EventClientMembership[]> {
  const { data, error } = await admin
    .from("event_clients")
    .select(
      "id, client_id, role, is_primary, is_contract_holder, client:clients(first_name, last_name, email, cell_phone)",
    )
    .eq("event_id", eventId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return mapEventClientMemberships(data);
}

/** Flip the Booking Agreement holder flag the same way the event page does. */
export async function setEventContractHolder(
  admin: SupabaseClient,
  input: { eventId: string; eventClientId: string; contractHolder: boolean },
): Promise<{ ok: true; contract_holder: boolean }> {
  const { error } = await admin.rpc("mcp_toggle_contract_holder", {
    p_event_id: input.eventId,
    p_event_client_id: input.eventClientId,
    p_value: input.contractHolder,
  });
  if (error) {
    if (/mcp_toggle_contract_holder|schema cache|could not find/i.test(error.message)) {
      throw new Error("Updating the contract holder needs migration 00221. Nothing was changed.");
    }
    throw new Error(error.message);
  }
  return { ok: true, contract_holder: input.contractHolder };
}

/** Attach a client with mcp_add_event_client, optionally marking the holder. */
export async function addEventClientMembership(
  admin: SupabaseClient,
  input: { eventId: string; clientId: string; role?: string | null; contractHolder?: boolean },
): Promise<{ ok: true; event_client_id: string; primary: boolean; contract_holder: boolean }> {
  const { count } = await admin.from("event_clients").select("id", { count: "exact", head: true }).eq("event_id", input.eventId);
  const isFirst = (count ?? 0) === 0;
  const { data: eventClientId, error } = await admin.rpc("mcp_add_event_client", {
    p_event_id: input.eventId,
    p_client_id: input.clientId,
    p_role: input.role?.trim() || "Client",
  });
  if (error) {
    if (/mcp_add_event_client|schema cache|could not find/i.test(error.message)) {
      throw new Error("Adding a client needs migration 00221. Nothing was added.");
    }
    throw new Error(error.message);
  }
  const holder = input.contractHolder === true;
  if (holder) {
    await setEventContractHolder(admin, {
      eventId: input.eventId,
      eventClientId: String(eventClientId),
      contractHolder: true,
    });
  }
  return { ok: true, event_client_id: String(eventClientId), primary: isFirst, contract_holder: holder };
}
