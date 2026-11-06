/* Explicit opt-in before personal event data is sent to OpenAI.
   No row, or a withdrawn row, means not granted. */

import type { SupabaseClient } from "@supabase/supabase-js";

export const AI_CONSENT_POLICY_VERSION = "2026-11-06";

export const AI_CONSENT_BLOCKED = "Client hasn't allowed AI tools for this event";

export type ConsentRow = {
  granted_at: string | null;
  withdrawn_at: string | null;
  policy_version?: string | null;
  source?: string | null;
};

export function consentIsActive(row: ConsentRow | null | undefined): boolean {
  if (!row?.granted_at) return false;
  if (!row.withdrawn_at) return true;
  return Date.parse(row.withdrawn_at) < Date.parse(row.granted_at);
}

export type ConsentActor = { staff: boolean; authUserId: string; onEvent: boolean };

/** Staff may read any row. A client or guest may read only their own. */
export function canReadConsent(actor: ConsentActor, rowUserId: string): boolean {
  return actor.staff || actor.authUserId === rowUserId;
}

/** Only the person themselves, while they are on the event, may grant or withdraw. Staff cannot. */
export function canWriteConsent(actor: ConsentActor, rowUserId: string): boolean {
  return actor.onEvent && !actor.staff && actor.authUserId === rowUserId;
}

/** Rows without that person's permission are left out of the model payload, not renamed. */
export function rowsForAi<T extends { allowed: boolean }>(rows: T[]): Omit<T, "allowed">[] {
  return rows.filter((row) => row.allowed).map(({ allowed: _allowed, ...rest }) => rest);
}

/** A free-text answer is included only when its author opted in. Unknown authors are omitted. */
export function answerAllowed(answeredBy: string | null | undefined, consentedUserIds: ReadonlySet<string>): boolean {
  return typeof answeredBy === "string" && answeredBy.length > 0 && consentedUserIds.has(answeredBy);
}

/** A song line is included only when the person who added it opted in.
    An unattributed song title can ride along with the contract client's own opt-in.
    Its free-text note never does, unless that author opted in. */
export function songLineAllowed(
  requestedBy: string | null | undefined,
  consentedUserIds: ReadonlySet<string>,
  contractUserId: string | null,
): boolean {
  if (typeof requestedBy === "string" && requestedBy.length > 0) return consentedUserIds.has(requestedBy);
  return typeof contractUserId === "string" && consentedUserIds.has(contractUserId);
}

export function songNoteAllowed(requestedBy: string | null | undefined, consentedUserIds: ReadonlySet<string>): boolean {
  return typeof requestedBy === "string" && requestedBy.length > 0 && consentedUserIds.has(requestedBy);
}

export function clientContactAllowed(clientId: string | null | undefined, consentedClientIds: ReadonlySet<string>): boolean {
  return typeof clientId === "string" && clientId.length > 0 && consentedClientIds.has(clientId);
}

/** Blocks emails and phone numbers typed into the staff assistant. Names in a sentence are not detected. */
export function assistantTextHasDirectContact(text: string): boolean {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return true;
  return /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]?\d{4}/.test(text);
}

export const ASSISTANT_CONTACT_BLOCKED =
  "This assistant is not an approved path for client contact details. Remove email addresses and phone numbers. Names typed in a sentence are not fully blocked here.";

async function contractClientId(sb: SupabaseClient, eventId: string): Promise<string | null> {
  const { data: event, error } = await sb.from("events").select("client_id").eq("id", eventId).maybeSingle();
  if (error || !event) return null;
  if (event.client_id) return event.client_id as string;
  const { data: links } = await sb
    .from("event_clients")
    .select("client_id, is_contract_holder, is_primary")
    .eq("event_id", eventId);
  const rows = (links ?? []) as { client_id: string; is_contract_holder: boolean; is_primary: boolean }[];
  return (rows.find((row) => row.is_contract_holder) ?? rows.find((row) => row.is_primary))?.client_id ?? null;
}

export async function contractClientAuthUserId(sb: SupabaseClient, eventId: string): Promise<string | null> {
  const clientId = await contractClientId(sb, eventId);
  if (!clientId) return null;
  const { data: account, error } = await sb
    .from("accounts")
    .select("auth_user_id")
    .eq("client_id", clientId)
    .eq("account_type", "client")
    .maybeSingle();
  if (error || !account?.auth_user_id) return null;
  return account.auth_user_id as string;
}

/** True only when the contract client's app login has an active consent for this event. */
export async function contractClientHasAiConsent(sb: SupabaseClient, eventId: string): Promise<boolean> {
  const userId = await contractClientAuthUserId(sb, eventId);
  if (!userId) return false;
  return callerHasAiConsent(sb, userId, eventId);
}

export async function callerHasAiConsent(sb: SupabaseClient, authUserId: string, eventId: string): Promise<boolean> {
  const { data, error } = await sb
    .from("ai_consents")
    .select("granted_at, withdrawn_at")
    .eq("auth_user_id", authUserId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) return false;
  return consentIsActive(data as ConsentRow | null);
}

/** People on this event with an active consent. A contract client's row does not add anyone else. */
export async function consentedPeopleForEvent(
  sb: SupabaseClient,
  eventId: string,
): Promise<{ userIds: Set<string>; clientIds: Set<string> }> {
  const userIds = new Set<string>();
  const clientIds = new Set<string>();
  const { data, error } = await sb
    .from("ai_consents")
    .select("auth_user_id, client_id, granted_at, withdrawn_at")
    .eq("event_id", eventId);
  if (error || !data?.length) return { userIds, clientIds };
  for (const row of data) {
    if (!consentIsActive(row as ConsentRow) || !row.auth_user_id) continue;
    userIds.add(row.auth_user_id as string);
    if (row.client_id) clientIds.add(row.client_id as string);
  }
  if (!userIds.size) return { userIds, clientIds };
  const { data: accounts } = await sb.from("accounts").select("auth_user_id, client_id").in("auth_user_id", [...userIds]);
  for (const account of accounts ?? []) {
    if (account.client_id && userIds.has(account.auth_user_id as string)) clientIds.add(account.client_id as string);
  }
  return { userIds, clientIds };
}

/** Event ids whose contract client has an active consent. Missing table fails closed. */
export async function consentedEventIds(sb: SupabaseClient, eventIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(eventIds.filter(Boolean))];
  const allowed = new Set<string>();
  if (!ids.length) return allowed;
  const { data: events, error } = await sb.from("events").select("id, client_id").in("id", ids);
  if (error || !events?.length) return allowed;
  const clientIds = [...new Set(events.map((event) => event.client_id).filter(Boolean))] as string[];
  if (!clientIds.length) return allowed;
  const { data: accounts, error: accountErr } = await sb
    .from("accounts")
    .select("auth_user_id, client_id")
    .eq("account_type", "client")
    .in("client_id", clientIds);
  if (accountErr || !accounts?.length) return allowed;
  const userByClient = new Map(accounts.map((row) => [row.client_id as string, row.auth_user_id as string]));
  const userIds = [...userByClient.values()];
  const { data: consents, error: consentErr } = await sb
    .from("ai_consents")
    .select("auth_user_id, event_id, granted_at, withdrawn_at")
    .in("event_id", ids)
    .in("auth_user_id", userIds);
  if (consentErr) return allowed;
  const active = new Set(
    (consents ?? [])
      .filter((row) => consentIsActive(row as ConsentRow))
      .map((row) => `${row.auth_user_id}:${row.event_id}`),
  );
  for (const event of events) {
    const userId = event.client_id ? userByClient.get(event.client_id as string) : undefined;
    if (userId && active.has(`${userId}:${event.id}`)) allowed.add(event.id as string);
  }
  return allowed;
}
