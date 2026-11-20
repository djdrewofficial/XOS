import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyContractHolderMergeTags,
  pickContractHolder,
  pickPartnerB,
  pickPlanners,
  type ContractHolderMember,
} from "@/lib/contractHolder";

export type EventPartyLayout = {
  holder: ContractHolderMember | null;
  partnerB: ContractHolderMember | null;
  planners: ContractHolderMember[];
  members: ContractHolderMember[];
};

/** Load event_clients and resolve Partner 1 (holder), Partner 2, and planners. */
export async function loadEventPartyLayout(
  admin: SupabaseClient,
  eventId: string,
): Promise<EventPartyLayout> {
  const [{ data: links }, { data: event }] = await Promise.all([
    admin
      .from("event_clients")
      .select(
        "id, client_id, role, is_primary, is_contract_holder, created_at, client:clients(id, first_name, last_name, email, cell_phone, organization, mailing_address, authorized_rep_name, authorized_rep_title, authorized_rep_email, authorized_rep_phone)",
      )
      .eq("event_id", eventId)
      .order("created_at"),
    admin.from("events").select("client_id").eq("id", eventId).maybeSingle(),
  ]);

  const members: ContractHolderMember[] = [];
  for (const link of links ?? []) {
    const client = link.client as unknown as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      cell_phone: string | null;
      organization: string | null;
      mailing_address: string | null;
      authorized_rep_name: string | null;
      authorized_rep_title: string | null;
      authorized_rep_email: string | null;
      authorized_rep_phone: string | null;
    } | null;
    if (!client?.id) continue;
    members.push({
      clientId: client.id,
      eventClientId: link.id as string,
      firstName: client.first_name,
      lastName: client.last_name,
      email: client.email,
      phone: client.cell_phone,
      organization: client.organization,
      mailingAddress: client.mailing_address,
      authorizedRepName: client.authorized_rep_name,
      authorizedRepTitle: client.authorized_rep_title,
      authorizedRepEmail: client.authorized_rep_email,
      authorizedRepPhone: client.authorized_rep_phone,
      role: (link.role as string | null) ?? null,
      isPrimary: Boolean(link.is_primary) || client.id === event?.client_id,
      isContractHolder: Boolean(link.is_contract_holder),
      createdAt: (link.created_at as string | null) ?? null,
    });
  }

  const holder = pickContractHolder({
    members,
    eventClientId: (event?.client_id as string | null) ?? null,
  });
  return {
    holder,
    partnerB: pickPartnerB(members, holder),
    planners: pickPlanners(members, holder),
    members,
  };
}

/** Full client row for the resolved contract holder (merge tags + documents). */
export async function loadContractHolderClient(
  admin: SupabaseClient,
  eventId: string,
): Promise<{
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  cell_phone: string | null;
  organization: string | null;
  mailing_address: string | null;
  authorized_rep_name: string | null;
  authorized_rep_title: string | null;
  authorized_rep_email: string | null;
  authorized_rep_phone: string | null;
} | null> {
  const layout = await loadEventPartyLayout(admin, eventId);
  if (!layout.holder) return null;
  const { data } = await admin
    .from("clients")
    .select(
      "id, first_name, last_name, email, cell_phone, organization, mailing_address, authorized_rep_name, authorized_rep_title, authorized_rep_email, authorized_rep_phone",
    )
    .eq("id", layout.holder.clientId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Merge-tag render that names the contract holder for client tags.
 * Applies holder tags in TypeScript first, then runs SQL render_merge_tags for
 * everything else (so this works before migration 00239 is applied).
 */
export async function renderEventMergeTags(
  admin: SupabaseClient,
  eventId: string,
  template: string,
): Promise<string> {
  const holder = await loadContractHolderClient(admin, eventId);
  let text = (template ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  text = applyContractHolderMergeTags(text, holder
    ? {
        firstName: holder.first_name,
        lastName: holder.last_name,
        email: holder.email,
        phone: holder.cell_phone,
        organization: holder.organization,
        mailingAddress: holder.mailing_address,
        authorizedRepName: holder.authorized_rep_name,
        authorizedRepTitle: holder.authorized_rep_title,
        authorizedRepEmail: holder.authorized_rep_email,
        authorizedRepPhone: holder.authorized_rep_phone,
      }
    : null);
  const { data, error } = await admin.rpc("render_merge_tags", {
    p_event_id: eventId,
    p_template: text,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? text;
}
