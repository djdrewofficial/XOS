import type { SupabaseClient } from "@supabase/supabase-js";

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
