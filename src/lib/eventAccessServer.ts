/* Server side of couple-app invites and join codes. Uses the service role
   after the route has already decided the caller is allowed. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBrandedEmail } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";
import { appUrl as siteOrigin } from "@/lib/signing";
import {
  canRemoveCoupleMember,
  canResendInvite,
  cleanRole,
  clientCellPhone,
  decryptJoinCode,
  appJoinScheme,
  decryptJoinToken,
  deliveryChannel,
  encryptJoinCode,
  encryptJoinToken,
  evaluateLinkRedeem,
  evaluateRedeem,
  escapeHtml,
  generateJoinCode,
  generateJoinToken,
  hashJoinCode,
  hashJoinToken,
  joinLinkExpiry,
  joinLinkUrl,
  holderRank,
  inviteExpiry,
  inviteMessage,
  joinCodeEmailSection,
  joinCodeExpiry,
  normalizeEmail,
  normalizeJoinCode,
  normalizeJoinToken,
  phoneMatchKey,
  pickAppUrl,
  placeAppJoinCode,
  planInviteClaim,
  resolveJoinCodeKey,
  samePhone,
  scrubText,
  splitPersonName,
  visibleInviteStatus,
  type InviteLang,
  type LinkRole,
  type OpenInvite,
  type ParsedInvite,
} from "@/lib/eventAccess";

type Admin = SupabaseClient;

export class AccessError extends Error {
  status: number;
  retryAfterSec?: number;
  constructor(status: number, message: string, retryAfterSec?: number) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("event_app_invites") ||
    msg.includes("event_join_codes") ||
    msg.includes("event_join_links") ||
    msg.includes("event_app_members") ||
    msg.includes("event_guest_card") ||
    msg.includes("schema cache")
  );
}

function setupError(): AccessError {
  return new AccessError(503, "App sharing needs a one-time database setup before it can be used.");
}

function assertNoMissing(error: { code?: string; message?: string } | null | undefined) {
  if (isMissingRelation(error)) throw setupError();
}

export type MemberDto = {
  clientId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  access: "couple";
  hasLogin: true;
  isContractHolder: boolean;
  isPrimary: boolean;
  canRemove: boolean;
};

export type InviteDto = {
  id: string;
  clientId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: "pending" | "expired" | "accepted";
  channel: "sms" | "email" | "sms_and_email";
  invitedBy: string | null;
  invitedByName: string | null;
  invitedAt: string;
  expiresAt: string;
  sentAt: string | null;
};

export type DeliveryDto = { channel: "sms" | "email"; ok: boolean; status?: string; error?: string };

type InviteRow = {
  id: string;
  event_id: string;
  client_id: string | null;
  created_client: boolean;
  email: string | null;
  phone: string | null;
  phone_digits: string | null;
  name: string | null;
  role: string;
  status: string;
  invited_by: string | null;
  invited_by_name: string | null;
  invited_at: string;
  expires_at: string;
  last_sent_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
};

type ClientCard = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  cell_phone: string | null;
};

type LinkRow = {
  id: string;
  client_id: string;
  role: string | null;
  is_primary: boolean;
  is_contract_holder: boolean;
  client: ClientCard | ClientCard[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function inviteDto(row: InviteRow, now: number, includeAccepted = false): InviteDto | null {
  const status = visibleInviteStatus(row.status, Date.parse(row.expires_at), now);
  if (status === "revoked") return null;
  if (status === "accepted" && !includeAccepted) return null;
  if (status !== "pending" && status !== "expired" && status !== "accepted") return null;
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status,
    channel: deliveryChannel(row.email, row.phone),
    invitedBy: row.invited_by,
    invitedByName: row.invited_by_name,
    invitedAt: row.invited_at,
    expiresAt: row.expires_at,
    sentAt: row.last_sent_at,
  };
}

function joinKey(): string {
  return resolveJoinCodeKey(process.env);
}

async function appUrl(admin: Admin): Promise<string | null> {
  const { data } = await admin
    .from("journey_settings")
    .select("vibo_ios_url, vibo_android_url, vibo_web_url")
    .eq("id", true)
    .maybeSingle();
  return pickAppUrl(process.env.CLIENT_APP_STORE_URL, {
    ios: data?.vibo_ios_url,
    android: data?.vibo_android_url,
    web: data?.vibo_web_url,
  });
}

async function timeZone(admin: Admin): Promise<string> {
  const { data } = await admin.from("company_settings").select("timezone").eq("id", true).maybeSingle();
  const zone = (data?.timezone as string | null | undefined)?.trim();
  return zone || "America/New_York";
}

async function eventName(admin: Admin, eventId: string): Promise<string> {
  const { data, error } = await admin.from("events").select("name, client_id").eq("id", eventId).maybeSingle();
  if (error) throw new AccessError(500, "Could not load the event.");
  if (!data) throw new AccessError(404, "That event was not found.");
  return scrubText(data.name as string | null, 120) || "your event";
}

async function personName(admin: Admin, userId: string): Promise<string> {
  const { data: acct } = await admin
    .from("accounts")
    .select("account_type, client_id, employee_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (acct?.client_id) {
    const { data: client } = await admin
      .from("clients")
      .select("first_name, last_name")
      .eq("id", acct.client_id)
      .maybeSingle();
    const name = `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim();
    if (name) return name;
  }
  if (acct?.employee_id) {
    const { data: emp } = await admin
      .from("employees")
      .select("first_name, last_name")
      .eq("id", acct.employee_id)
      .maybeSingle();
    const name = `${emp?.first_name ?? ""} ${emp?.last_name ?? ""}`.trim();
    if (name) return name;
  }
  return "Someone";
}

async function logEvent(admin: Admin, eventId: string, actor: string, action: string) {
  await admin.from("event_logs").insert({ event_id: eventId, actor: scrubText(actor, 80) || "Someone", action });
}

async function findClient(admin: Admin, email: string | null, phoneE164: string | null): Promise<ClientCard | null> {
  const digits = phoneMatchKey(phoneE164);
  const dashed = clientCellPhone(phoneE164);
  const phoneFilters = [digits, dashed].filter((value): value is string => Boolean(value));
  const [byEmail, byPhone] = await Promise.all([
    email
      ? admin.from("clients").select("id, first_name, last_name, email, cell_phone").ilike("email", email).limit(20)
      : Promise.resolve({ data: [] as ClientCard[] }),
    phoneFilters.length
      ? admin
          .from("clients")
          .select("id, first_name, last_name, email, cell_phone")
          .or(phoneFilters.map((value) => `cell_phone.ilike.%${value}`).join(","))
          .limit(20)
      : Promise.resolve({ data: [] as ClientCard[] }),
  ]);
  const rows = [...((byEmail.data ?? []) as ClientCard[]), ...((byPhone.data ?? []) as ClientCard[])];
  return (
    rows.find((row) => email && normalizeEmail(row.email) === email) ??
    rows.find((row) => digits && samePhone(row.cell_phone, digits)) ??
    null
  );
}

async function loadLinks(admin: Admin, eventId: string): Promise<{ anchorId: string | null; links: LinkRow[] }> {
  const [{ data: event, error: eventErr }, { data: links, error: linkErr }] = await Promise.all([
    admin.from("events").select("client_id, name").eq("id", eventId).maybeSingle(),
    admin
      .from("event_clients")
      .select("id, client_id, role, is_primary, is_contract_holder, client:clients(id, first_name, last_name, email, cell_phone)")
      .eq("event_id", eventId),
  ]);
  if (eventErr) throw new AccessError(500, "Could not load the event.");
  if (!event) throw new AccessError(404, "That event was not found.");
  if (linkErr) throw new AccessError(500, "Could not load the people on this event.");
  return { anchorId: (event.client_id as string | null) ?? null, links: (links ?? []) as LinkRow[] };
}

function linkFor(links: LinkRow[], clientId: string): LinkRow | undefined {
  return links.find((row) => row.client_id === clientId);
}

export async function listEventAccess(eventId: string, now = Date.now()): Promise<{ members: MemberDto[]; invites: InviteDto[] }> {
  const admin = createAdminClient();
  const { anchorId, links } = await loadLinks(admin, eventId);
  const clientIds = links.map((row) => row.client_id).filter(Boolean);
  const [{ data: accounts, error: acctErr }, { data: invites, error: inviteErr }] = await Promise.all([
    clientIds.length
      ? admin.from("accounts").select("client_id").eq("account_type", "client").in("client_id", clientIds)
      : Promise.resolve({ data: [] as { client_id: string }[], error: null }),
    admin.from("event_app_invites").select("*").eq("event_id", eventId).eq("status", "pending").order("invited_at", { ascending: false }),
  ]);
  assertNoMissing(inviteErr);
  if (acctErr) throw new AccessError(500, "Could not load app logins.");
  if (inviteErr) throw new AccessError(500, "Could not load invites.");

  const withLogin = new Set((accounts ?? []).map((row) => row.client_id as string));
  const members: MemberDto[] = [];
  for (const link of links) {
    if (!withLogin.has(link.client_id)) continue;
    const client = one(link.client);
    const name = `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim() || "Partner";
    const isContractHolder = Boolean(link.is_contract_holder);
    const isPrimary = Boolean(link.is_primary);
    const isAnchor = anchorId === link.client_id;
    members.push({
      clientId: link.client_id,
      name,
      email: client?.email ?? null,
      phone: client?.cell_phone ?? null,
      role: link.role || "Partner",
      access: "couple",
      hasLogin: true,
      isContractHolder,
      isPrimary,
      canRemove: canRemoveCoupleMember({ onEvent: true, isContractHolder, isPrimary, isAnchor }) === "ok",
    });
  }

  return {
    members,
    invites: ((invites ?? []) as InviteRow[])
      .map((row) => inviteDto(row, now))
      .filter((row): row is InviteDto => row != null),
  };
}

async function ensureClient(
  admin: Admin,
  parsed: ParsedInvite & { ok: true },
  existing: ClientCard | null,
): Promise<{ id: string; created: boolean }> {
  if (existing) return { id: existing.id, created: false };
  const { data, error } = await admin
    .from("clients")
    .insert({
      first_name: parsed.firstName,
      last_name: parsed.lastName,
      email: parsed.email,
      cell_phone: clientCellPhone(parsed.phoneE164),
    })
    .select("id")
    .single();
  if (error || !data) throw new AccessError(500, "Could not save that contact.");
  return { id: data.id as string, created: true };
}

async function ensureLink(admin: Admin, eventId: string, clientId: string, role: string) {
  const { error } = await admin.from("event_clients").insert({
    event_id: eventId,
    client_id: clientId,
    role,
    is_primary: false,
    is_contract_holder: false,
  });
  if (error && error.code !== "23505") throw new AccessError(500, "Could not add that person to the event.");
}

async function hostJoinUrl(admin: Admin, eventId: string): Promise<string | null> {
  try {
    const links = await ensureJoinLinks(admin, eventId, null);
    return links.find((link) => link.role === "host")?.url ?? null;
  } catch (err) {
    if (err instanceof AccessError && err.status === 503) return null;
    throw err;
  }
}

async function deliver(
  admin: Admin,
  opts: {
    eventId: string;
    clientId: string | null;
    email: string | null;
    phone: string | null;
    inviter: string;
    event: string;
    lang: InviteLang;
  },
): Promise<DeliveryDto[]> {
  const url = await appUrl(admin);
  const joinUrl = await hostJoinUrl(admin, opts.eventId);
  const results: DeliveryDto[] = [];
  if (opts.phone) {
    const text = inviteMessage({
      inviter: opts.inviter,
      eventName: opts.event,
      url,
      joinUrl,
      channel: "sms",
      lang: opts.lang,
    });
    const { data, error } = await admin
      .from("sms_log")
      .insert({
        event_id: opts.eventId,
        client_id: opts.clientId,
        to_number: opts.phone,
        body: text.sms,
        status: "queued",
        is_marketing: false,
        bypass_comms_pause: true,
      })
      .select("id")
      .single();
    if (error || !data) {
      results.push({ channel: "sms", ok: false, error: "Could not queue the text." });
    } else {
      try {
        await processSmsOutbox(admin);
      } catch (err) {
        console.error("invite sms drain", err instanceof Error ? err.message : err);
      }
      const { data: row } = await admin.from("sms_log").select("status, error").eq("id", data.id).maybeSingle();
      const status = (row?.status as string | undefined) ?? "queued";
      results.push({
        channel: "sms",
        ok: status === "queued" || status === "sending" || status === "sent",
        status,
        error: status === "failed" || status === "suppressed" ? (row?.error as string | undefined) ?? "The text did not send." : undefined,
      });
    }
  }
  if (opts.email) {
    const mail = inviteMessage({
      inviter: opts.inviter,
      eventName: opts.event,
      url,
      joinUrl,
      channel: "email",
      lang: opts.lang,
    });
    const sent = await sendBrandedEmail({
      to: opts.email,
      subject: mail.subject,
      contentHtml: mail.html,
      loggedBodyHtml: mail.loggedHtml,
      supabase: admin,
    });
    results.push({ channel: "email", ok: sent.ok, error: sent.ok ? undefined : sent.error ?? "The email did not send." });
  }
  return results;
}

export async function createEventInvite(args: {
  eventId: string;
  userId: string;
  callerEmail: string | null;
  callerPhone: string | null;
  parsed: ParsedInvite & { ok: true };
  now?: number;
}): Promise<{ invite: InviteDto; delivery: DeliveryDto[] }> {
  const now = args.now ?? Date.now();
  const admin = createAdminClient();
  const parsed = args.parsed;
  if (
    (parsed.email && normalizeEmail(args.callerEmail) === parsed.email) ||
    (parsed.phoneE164 && samePhone(args.callerPhone, parsed.phoneE164))
  ) {
    throw new AccessError(400, "That's already your phone or email.");
  }

  const [eventLabel, inviter, existingClient, { links }] = await Promise.all([
    eventName(admin, args.eventId),
    personName(admin, args.userId),
    findClient(admin, parsed.email, parsed.phoneE164),
    loadLinks(admin, args.eventId),
  ]);

  let existingLogin: string | null = null;
  if (existingClient) {
    const { data: acct } = await admin
      .from("accounts")
      .select("auth_user_id")
      .eq("account_type", "client")
      .eq("client_id", existingClient.id)
      .maybeSingle();
    existingLogin = (acct?.auth_user_id as string | undefined) ?? null;
    if (existingLogin && linkFor(links, existingClient.id)) {
      throw new AccessError(409, "They're already on this event.");
    }
  }

  const client = await ensureClient(admin, parsed, existingClient);
  await ensureLink(admin, args.eventId, client.id, parsed.role);

  const { data: pending, error: pendingErr } = await admin
    .from("event_app_invites")
    .select("*")
    .eq("event_id", args.eventId)
    .eq("status", "pending");
  assertNoMissing(pendingErr);
  if (pendingErr) throw new AccessError(500, "Could not save the invite.");

  const matches = ((pending ?? []) as InviteRow[]).filter(
    (row) => (parsed.email && row.email === parsed.email) || (parsed.phoneDigits && row.phone_digits === parsed.phoneDigits),
  );
  const expires = new Date(inviteExpiry(now)).toISOString();
  const sentAt = new Date(now).toISOString();
  const acceptance = existingLogin
    ? { status: "accepted", accepted_at: sentAt, accepted_by: existingLogin }
    : { status: "pending", accepted_at: null, accepted_by: null };
  let saved: InviteRow;
  if (matches.length) {
    for (const extra of matches.slice(1)) {
      await admin
        .from("event_app_invites")
        .update({ status: "revoked", revoked_at: sentAt, revoked_by: args.userId, updated_at: sentAt })
        .eq("id", extra.id);
    }
    const { data, error } = await admin
      .from("event_app_invites")
      .update({
        client_id: client.id,
        email: parsed.email,
        phone: parsed.phoneE164,
        phone_digits: parsed.phoneDigits,
        name: parsed.name,
        role: parsed.role,
        expires_at: expires,
        last_sent_at: sentAt,
        updated_at: sentAt,
        ...acceptance,
      })
      .eq("id", matches[0].id)
      .select("*")
      .single();
    if (error || !data) throw new AccessError(500, "Could not save the invite.");
    saved = data as InviteRow;
  } else {
    const { data, error } = await admin
      .from("event_app_invites")
      .insert({
        event_id: args.eventId,
        client_id: client.id,
        created_client: client.created,
        email: parsed.email,
        phone: parsed.phoneE164,
        phone_digits: parsed.phoneDigits,
        name: parsed.name,
        role: parsed.role,
        invited_by: args.userId,
        invited_by_name: inviter,
        invited_at: sentAt,
        expires_at: expires,
        last_sent_at: sentAt,
        ...acceptance,
      })
      .select("*")
      .single();
    assertNoMissing(error);
    if (error || !data) throw new AccessError(500, "Could not save the invite.");
    saved = data as InviteRow;
  }

  const delivery = await deliver(admin, {
    eventId: args.eventId,
    clientId: client.id,
    email: parsed.email,
    phone: parsed.phoneE164,
    inviter,
    event: eventLabel,
    lang: parsed.lang,
  });
  const who = parsed.name || parsed.email || parsed.phoneE164 || "someone";
  await logEvent(admin, args.eventId, inviter, `App invite sent to ${scrubText(who, 80)}`);
  const dto = inviteDto(saved, now, Boolean(existingLogin));
  if (!dto) throw new AccessError(500, "Could not save the invite.");
  return { invite: dto, delivery };
}

export async function resendEventInvite(args: { eventId: string; inviteId: string; userId: string; now?: number }) {
  const now = args.now ?? Date.now();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("event_app_invites")
    .select("*")
    .eq("id", args.inviteId)
    .eq("event_id", args.eventId)
    .maybeSingle();
  assertNoMissing(error);
  if (error) throw new AccessError(500, "Could not load the invite.");
  if (!data) throw new AccessError(404, "That invite was not found.");
  const row = data as InviteRow;
  if (row.status === "revoked") throw new AccessError(409, "This invite was revoked. Send a new one.");
  if (row.status === "accepted") throw new AccessError(409, "They already joined.");
  if (!canResendInvite(row.status, Date.parse(row.expires_at), now)) {
    throw new AccessError(409, "This invite can't be sent again.");
  }
  const expires = new Date(inviteExpiry(now)).toISOString();
  const sentAt = new Date(now).toISOString();
  const { data: saved, error: upErr } = await admin
    .from("event_app_invites")
    .update({ status: "pending", expires_at: expires, last_sent_at: sentAt, updated_at: sentAt })
    .eq("id", row.id)
    .select("*")
    .single();
  if (upErr || !saved) throw new AccessError(500, "Could not update the invite.");
  const [eventLabel, inviter] = await Promise.all([eventName(admin, args.eventId), personName(admin, args.userId)]);
  const delivery = await deliver(admin, {
    eventId: args.eventId,
    clientId: row.client_id,
    email: row.email,
    phone: row.phone,
    inviter,
    event: eventLabel,
    lang: "both",
  });
  await logEvent(admin, args.eventId, inviter, `App invite resent to ${scrubText(row.name || row.email || row.phone || "someone", 80)}`);
  const dto = inviteDto(saved as InviteRow, now);
  if (!dto) throw new AccessError(500, "Could not update the invite.");
  return { invite: dto, delivery };
}

export async function revokeEventInvite(args: { eventId: string; inviteId: string; userId: string; actorName?: string }) {
  const admin = createAdminClient();
  const actor = args.actorName || (await personName(admin, args.userId));
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("event_app_invites")
    .update({
      status: "revoked",
      revoked_at: now,
      revoked_by: args.userId,
      revoked_by_name: actor,
      updated_at: now,
    })
    .eq("id", args.inviteId)
    .eq("event_id", args.eventId)
    .eq("status", "pending")
    .select("id, name, email, phone")
    .maybeSingle();
  assertNoMissing(error);
  if (error) throw new AccessError(500, "Could not revoke the invite.");
  if (!data) {
    const { data: existing } = await admin
      .from("event_app_invites")
      .select("id, status")
      .eq("id", args.inviteId)
      .eq("event_id", args.eventId)
      .maybeSingle();
    if (!existing) throw new AccessError(404, "That invite was not found.");
    return { ok: true as const };
  }
  await logEvent(
    admin,
    args.eventId,
    actor,
    `App invite revoked for ${scrubText((data.name as string) || (data.email as string) || (data.phone as string) || "someone", 80)}`,
  );
  return { ok: true as const };
}

export async function removeCoupleMember(args: { eventId: string; clientId: string; userId: string; actorName?: string }) {
  const admin = createAdminClient();
  const { anchorId, links } = await loadLinks(admin, args.eventId);
  const link = linkFor(links, args.clientId);
  const decision = canRemoveCoupleMember({
    onEvent: Boolean(link),
    isContractHolder: Boolean(link?.is_contract_holder),
    isPrimary: Boolean(link?.is_primary),
    isAnchor: anchorId === args.clientId,
  });
  if (decision === "missing") throw new AccessError(404, "That person is not on this event.");
  if (decision === "protected") throw new AccessError(403, "The contract holder stays on the event.");
  const { error } = await admin.from("event_clients").delete().eq("event_id", args.eventId).eq("client_id", args.clientId);
  if (error) throw new AccessError(500, "Could not remove that person.");
  const now = new Date().toISOString();
  await admin
    .from("event_app_invites")
    .update({ status: "revoked", revoked_at: now, revoked_by: args.userId, updated_at: now })
    .eq("event_id", args.eventId)
    .eq("client_id", args.clientId)
    .eq("status", "pending");
  const actor = args.actorName || (await personName(admin, args.userId));
  const client = one(link?.client);
  const name = `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim() || "a partner";
  await logEvent(admin, args.eventId, actor, `Removed ${scrubText(name, 80)} from the couple's app`);
  return { ok: true as const };
}

type CodeRow = { event_id: string; code_hash: string; code_ciphertext: string; expires_at: string };

async function readCode(admin: Admin, eventId: string, key: string, now: number): Promise<{ code: string; expiresAt: string } | null> {
  const { data, error } = await admin.from("event_join_codes").select("event_id, code_hash, code_ciphertext, expires_at").eq("event_id", eventId).maybeSingle();
  assertNoMissing(error);
  if (error) throw new AccessError(500, "Could not load the join code.");
  if (!data) return null;
  const row = data as CodeRow;
  if (Date.parse(row.expires_at) <= now) return null;
  const code = decryptJoinCode(row.code_ciphertext, key);
  if (!code) return null;
  return { code, expiresAt: row.expires_at };
}

async function writeCode(admin: Admin, eventId: string, userId: string | null, now: number, reset: boolean) {
  const key = joinKey();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateJoinCode();
    const codeHash = hashJoinCode(code, key);
    if (!codeHash) continue;
    const row = {
      event_id: eventId,
      code_hash: codeHash,
      code_ciphertext: encryptJoinCode(code, key),
      expires_at: new Date(joinCodeExpiry(now)).toISOString(),
      created_by: userId,
      reset_at: reset ? new Date(now).toISOString() : null,
      reset_by: reset ? userId : null,
    };
    const { error } = await admin.from("event_join_codes").upsert(row, { onConflict: "event_id" });
    assertNoMissing(error);
    if (!error) return { code, expiresAt: row.expires_at };
    if (error.code !== "23505") throw new AccessError(500, "Could not save the join code.");
  }
  throw new AccessError(500, "Could not save the join code.");
}

export async function getJoinCode(eventId: string, userId: string | null, now = Date.now()) {
  const admin = createAdminClient();
  await eventName(admin, eventId);
  const key = joinKey();
  const current = await readCode(admin, eventId, key, now);
  const code = current ?? (await writeCode(admin, eventId, userId, now, false));
  return { code: formatStored(code.code), expiresAt: code.expiresAt, eventId };
}

export async function resetJoinCode(eventId: string, userId: string, now = Date.now()) {
  const admin = createAdminClient();
  await eventName(admin, eventId);
  const code = await writeCode(admin, eventId, userId, now, true);
  const actor = await personName(admin, userId);
  await logEvent(admin, eventId, actor, "Reset the app join code");
  return { code: formatStored(code.code), expiresAt: code.expiresAt, eventId };
}

function formatStored(normalized: string): string {
  const code = normalizeJoinCode(normalized);
  if (!code) throw new AccessError(500, "Could not read the join code.");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export async function redeemJoinCode(args: {
  userId: string;
  accountType: "staff" | "client" | "event_guest" | null;
  clientId: string | null;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  rawCode: string;
  ip: string | null;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const admin = createAdminClient();
  const since = new Date(now - 60 * 60 * 1000).toISOString();
  const [{ data: userRows, error: userErr }, { data: ipRows, error: ipErr }] = await Promise.all([
    admin
      .from("event_join_attempts")
      .select("created_at")
      .eq("auth_user_id", args.userId)
      .eq("success", false)
      .gte("created_at", since),
    args.ip
      ? admin.from("event_join_attempts").select("created_at").eq("ip", args.ip).eq("success", false).gte("created_at", since)
      : Promise.resolve({ data: [] as { created_at: string }[], error: null }),
  ]);
  assertNoMissing(userErr ?? ipErr);
  if (userErr || ipErr) throw new AccessError(500, "Could not check that code.");

  const key = joinKey();
  const normalized = normalizeJoinCode(args.rawCode);
  const codeHash = normalized ? hashJoinCode(normalized, key) : null;
  let match: { eventId: string; expiresAt: number } | null = null;
  if (codeHash) {
    const { data, error } = await admin
      .from("event_join_codes")
      .select("event_id, expires_at")
      .eq("code_hash", codeHash)
      .maybeSingle();
    assertNoMissing(error);
    if (error) throw new AccessError(500, "Could not check that code.");
    if (data) match = { eventId: data.event_id as string, expiresAt: Date.parse(data.expires_at as string) };
  }

  let alreadyOnEvent = false;
  if (match && args.clientId) {
    const { anchorId, links } = await loadLinks(admin, match.eventId);
    alreadyOnEvent = Boolean(linkFor(links, args.clientId)) || anchorId === args.clientId;
  }

  const decision = evaluateRedeem({
    accountType: args.accountType,
    rawCode: args.rawCode,
    now,
    userFailures: (userRows ?? []).map((row) => Date.parse(row.created_at as string)),
    ipFailures: (ipRows ?? []).map((row) => Date.parse(row.created_at as string)),
    match,
    alreadyOnEvent,
  });

  if (!decision.ok) {
    if (decision.countFailure) {
      await admin.from("event_join_attempts").insert({
        auth_user_id: args.userId,
        ip: args.ip,
        code_hash: codeHash,
        event_id: match?.eventId ?? null,
        success: false,
      });
    }
    throw new AccessError(decision.status, decision.error, decision.retryAfterSec);
  }

  if (!decision.alreadyMember) {
    await linkJoiner(admin, {
      eventId: decision.eventId,
      userId: args.userId,
      clientId: args.clientId,
      email: normalizeEmail(args.email),
      phone: args.phone,
      displayName: args.displayName,
    });
  }

  await admin.from("event_join_attempts").insert({
    auth_user_id: args.userId,
    ip: args.ip,
    code_hash: codeHash,
    event_id: decision.eventId,
    success: true,
  });

  return { ok: true as const, eventId: decision.eventId, role: "Partner", alreadyMember: decision.alreadyMember };
}

async function linkJoiner(
  admin: Admin,
  args: {
    eventId: string;
    userId: string;
    clientId: string | null;
    email: string | null;
    phone: string | null;
    displayName: string | null;
  },
) {
  let clientId = args.clientId;
  if (!clientId) {
    const parts = splitPersonName(args.displayName);
    const { data, error } = await admin
      .from("clients")
      .insert({
        first_name: parts.first,
        last_name: parts.last,
        email: args.email,
        cell_phone: clientCellPhone(args.phone),
      })
      .select("id")
      .single();
    if (error || !data) throw new AccessError(500, "Could not add you to the event.");
    clientId = data.id as string;
    const { error: acctErr } = await admin.from("accounts").insert({
      auth_user_id: args.userId,
      account_type: "client",
      client_id: clientId,
      email: args.email,
      updated_at: new Date().toISOString(),
    });
    if (acctErr) throw new AccessError(500, "Could not add you to the event.");
  }
  const { error } = await admin.from("event_clients").insert({
    event_id: args.eventId,
    client_id: clientId,
    role: "Partner",
    is_primary: false,
    is_contract_holder: false,
  });
  if (error && error.code !== "23505") throw new AccessError(500, "Could not add you to the event.");
  await rememberMember(admin, args.eventId, args.userId, "host");
}

async function rememberMember(admin: Admin, eventId: string, userId: string, role: LinkRole) {
  const { error } = await admin.from("event_app_members").upsert(
    { event_id: eventId, auth_user_id: userId, role },
    { onConflict: "event_id,auth_user_id" },
  );
  if (isMissingRelation(error)) return;
  if (error) throw new AccessError(500, "Could not save your place on the event.");
}

export async function claimInvitesForUser(args: {
  userId: string;
  accountType: "staff" | "client" | "event_guest" | null;
  clientId: string | null;
  email: string | null;
  phone: string | null;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const admin = createAdminClient();
  const email = normalizeEmail(args.email);
  const digits = phoneMatchKey(args.phone);
  const [byEmail, byPhone] = await Promise.all([
    email
      ? admin.from("event_app_invites").select("*").eq("status", "pending").eq("email", email)
      : Promise.resolve({ data: [] as InviteRow[], error: null }),
    digits
      ? admin.from("event_app_invites").select("*").eq("status", "pending").eq("phone_digits", digits)
      : Promise.resolve({ data: [] as InviteRow[], error: null }),
  ]);
  assertNoMissing(byEmail.error ?? byPhone.error);
  if (byEmail.error || byPhone.error) throw new AccessError(500, "Could not check invites.");

  const seen = new Set<string>();
  const invites: OpenInvite[] = [];
  for (const row of [...((byEmail.data ?? []) as InviteRow[]), ...((byPhone.data ?? []) as InviteRow[])]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    invites.push({
      id: row.id,
      eventId: row.event_id,
      clientId: row.client_id,
      createdClient: row.created_client,
      role: row.role,
      email: row.email,
      phoneDigits: row.phone_digits,
      status: row.status,
      expiresAt: Date.parse(row.expires_at),
      invitedAt: Date.parse(row.invited_at),
    });
  }

  const plan = planInviteClaim({
    accountType: args.accountType,
    clientId: args.clientId,
    email,
    phoneDigits: digits,
    invites,
    now,
  });

  const accepted: string[] = [];
  let accountReady = args.accountType === "client" && Boolean(args.clientId);
  for (const action of plan.actions) {
    if (action.createAccount && !accountReady) {
      const { error } = await admin.from("accounts").insert({
        auth_user_id: args.userId,
        account_type: "client",
        client_id: action.useClientId,
        email,
        updated_at: new Date(now).toISOString(),
      });
      if (error) {
        const { data: mine } = await admin
          .from("accounts")
          .select("client_id")
          .eq("auth_user_id", args.userId)
          .eq("account_type", "client")
          .maybeSingle();
        if (mine?.client_id !== action.useClientId) break;
      }
      accountReady = true;
    }
    if (action.dropPlaceholderClientId) {
      await admin.from("event_clients").insert({
        event_id: action.eventId,
        client_id: action.useClientId,
        role: cleanRole(action.role),
        is_primary: false,
        is_contract_holder: false,
      });
      await admin.from("event_clients").delete().eq("event_id", action.eventId).eq("client_id", action.dropPlaceholderClientId);
      await deletePlaceholder(admin, action.dropPlaceholderClientId);
    } else {
      const { error } = await admin.from("event_clients").insert({
        event_id: action.eventId,
        client_id: action.useClientId,
        role: cleanRole(action.role),
        is_primary: false,
        is_contract_holder: false,
      });
      if (error && error.code !== "23505") continue;
    }
    const { data } = await admin
      .from("event_app_invites")
      .update({
        status: "accepted",
        accepted_at: new Date(now).toISOString(),
        accepted_by: args.userId,
        updated_at: new Date(now).toISOString(),
      })
      .eq("id", action.inviteId)
      .eq("status", "pending")
      .select("event_id")
      .maybeSingle();
    if (data?.event_id) accepted.push(data.event_id as string);
  }

  return { ok: true as const, eventIds: [...new Set(accepted)], reason: plan.reason };
}

async function deletePlaceholder(admin: Admin, clientId: string) {
  const [links, anchors, accounts] = await Promise.all([
    admin.from("event_clients").select("id", { count: "exact", head: true }).eq("client_id", clientId),
    admin.from("events").select("id", { count: "exact", head: true }).eq("client_id", clientId),
    admin.from("accounts").select("auth_user_id", { count: "exact", head: true }).eq("client_id", clientId),
  ]);
  if ((links.count ?? 0) === 0 && (anchors.count ?? 0) === 0 && (accounts.count ?? 0) === 0) {
    await admin.from("clients").delete().eq("id", clientId);
  }
}

export async function emailJoinCodeToHolder(args: { eventId: string; userId: string; reset: boolean }) {
  const admin = createAdminClient();
  const { anchorId, links } = await loadLinks(admin, args.eventId);
  const ranked = links
    .map((link) => ({ link, client: one(link.client) }))
    .filter((row) => row.client?.email)
    .sort(
      (a, b) =>
        holderRank({
          isContractHolder: a.link.is_contract_holder || a.link.client_id === anchorId,
          isPrimary: a.link.is_primary,
        }) -
        holderRank({
          isContractHolder: b.link.is_contract_holder || b.link.client_id === anchorId,
          isPrimary: b.link.is_primary,
        }),
    );
  const holder = ranked[0];
  if (!holder?.client?.email) throw new AccessError(400, "The contract holder needs an email first.");
  const now = Date.now();
  const code = args.reset
    ? await writeCode(admin, args.eventId, args.userId, now, true)
    : (await readCode(admin, args.eventId, joinKey(), now)) ?? (await writeCode(admin, args.eventId, args.userId, now, false));
  const name = await eventName(admin, args.eventId);
  const section = joinCodeEmailSection({
    code: code.code,
    eventName: name,
    expiresAt: Date.parse(code.expiresAt),
    timeZone: await timeZone(admin),
    url: await appUrl(admin),
  });
  const logged = joinCodeEmailSection({
    code: null,
    eventName: name,
    expiresAt: Date.parse(code.expiresAt),
    timeZone: await timeZone(admin),
    url: await appUrl(admin),
    redact: true,
  });
  const sent = await sendBrandedEmail({
    to: holder.client.email,
    subject: section.subject,
    contentHtml: section.html,
    loggedBodyHtml: logged.html,
    supabase: admin,
  });
  if (!sent.ok) throw new AccessError(502, sent.error ?? "The email did not send.");
  const actor = await personName(admin, args.userId);
  const who = `${holder.client.first_name ?? ""} ${holder.client.last_name ?? ""}`.trim() || holder.client.email;
  await logEvent(admin, args.eventId, actor, `${args.reset ? "Reset and emailed" : "Emailed"} the app join code to ${scrubText(who, 80)}`);
  return { ok: true as const, emailed: holder.client.email };
}

/** Section for the existing client invite email. Null if the tables are not there yet. */
export async function appJoinCodeEmailParts(eventId: string): Promise<{ delivered: string; logged: string } | null> {
  try {
    const admin = createAdminClient();
    const now = Date.now();
    const current = (await readCode(admin, eventId, joinKey(), now)) ?? (await writeCode(admin, eventId, null, now, false));
    const name = await eventName(admin, eventId);
    const zone = await timeZone(admin);
    const url = await appUrl(admin);
    const delivered = joinCodeEmailSection({
      code: current.code,
      eventName: name,
      expiresAt: Date.parse(current.expiresAt),
      timeZone: zone,
      url,
    });
    const logged = joinCodeEmailSection({
      code: null,
      eventName: name,
      expiresAt: Date.parse(current.expiresAt),
      timeZone: zone,
      url,
      redact: true,
    });
    return { delivered: delivered.html, logged: logged.html };
  } catch (err) {
    if (err instanceof AccessError && err.status === 503) return null;
    console.error("app join code section", err instanceof Error ? err.message : err);
    return null;
  }
}

export { escapeHtml, placeAppJoinCode };

export type JoinLinkCard = {
  role: LinkRole;
  url: string;
  expiresAt: string;
};

type StoredJoinLink = {
  role: string;
  token_ciphertext: string;
  expires_at: string;
};

async function readLink(
  admin: Admin,
  eventId: string,
  role: LinkRole,
  key: string,
  now: number,
): Promise<JoinLinkCard | null> {
  const { data, error } = await admin
    .from("event_join_links")
    .select("role, token_ciphertext, expires_at")
    .eq("event_id", eventId)
    .eq("role", role)
    .maybeSingle();
  assertNoMissing(error);
  if (error) throw new AccessError(500, "Could not load the join link.");
  if (!data) return null;
  const row = data as StoredJoinLink;
  if (Date.parse(row.expires_at) <= now) return null;
  const token = decryptJoinToken(row.token_ciphertext, key);
  if (!token) return null;
  return { role, url: joinLinkUrl(siteOrigin(), token), expiresAt: row.expires_at };
}

async function writeLink(
  admin: Admin,
  eventId: string,
  role: LinkRole,
  userId: string | null,
  now: number,
  reset: boolean,
): Promise<JoinLinkCard> {
  const key = joinKey();
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateJoinToken();
    const tokenHash = hashJoinToken(token, key);
    if (!tokenHash) continue;
    const row = {
      event_id: eventId,
      role,
      token_hash: tokenHash,
      token_ciphertext: encryptJoinToken(token, key),
      expires_at: new Date(joinLinkExpiry(now)).toISOString(),
      created_by: userId,
      reset_at: reset ? new Date(now).toISOString() : null,
      reset_by: reset ? userId : null,
    };
    const { error } = await admin.from("event_join_links").upsert(row, { onConflict: "event_id,role" });
    assertNoMissing(error);
    if (!error) return { role, url: joinLinkUrl(siteOrigin(), token), expiresAt: row.expires_at };
    if (error.code !== "23505") throw new AccessError(500, "Could not save the join link.");
  }
  throw new AccessError(500, "Could not save the join link.");
}

export async function ensureJoinLinks(
  admin: Admin,
  eventId: string,
  userId: string | null,
  now = Date.now(),
): Promise<JoinLinkCard[]> {
  await eventName(admin, eventId);
  const key = joinKey();
  const roles: LinkRole[] = ["host", "guest"];
  const out: JoinLinkCard[] = [];
  for (const role of roles) {
    const current = await readLink(admin, eventId, role, key, now);
    out.push(current ?? (await writeLink(admin, eventId, role, userId, now, false)));
  }
  return out;
}

export async function loadJoinLinks(
  eventId: string,
): Promise<{ links: JoinLinkCard[]; setup: boolean; error: string | null }> {
  try {
    const admin = createAdminClient();
    return { links: await ensureJoinLinks(admin, eventId, null), setup: false, error: null };
  } catch (err) {
    if (err instanceof AccessError && err.status === 503) return { links: [], setup: true, error: null };
    return { links: [], setup: false, error: "Couldn't load the join links." };
  }
}

export async function resetJoinLink(eventId: string, role: LinkRole, userId: string, now = Date.now()) {
  const admin = createAdminClient();
  await eventName(admin, eventId);
  const link = await writeLink(admin, eventId, role, userId, now, true);
  const actor = await personName(admin, userId);
  await logEvent(admin, eventId, actor, role === "host" ? "Reset the host join link" : "Reset the guest join link");
  return link;
}

/** Raw URLs for <app_host_link> and <app_guest_link>. Null until the table exists. */
export async function joinLinkTagValues(eventId: string): Promise<{ host: string; guest: string } | null> {
  try {
    const admin = createAdminClient();
    const links = await ensureJoinLinks(admin, eventId, null);
    return {
      host: links.find((link) => link.role === "host")?.url ?? "",
      guest: links.find((link) => link.role === "guest")?.url ?? "",
    };
  } catch (err) {
    if (err instanceof AccessError && (err.status === 503 || err.status === 404)) return null;
    console.error("join links", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function describeJoinLink(token: string): Promise<
  | {
      ok: true;
      role: LinkRole;
      eventName: string;
      pageUrl: string;
      schemeUrl: string;
      code: string | null;
      storeUrl: string | null;
    }
  | { ok: false }
> {
  const normalized = normalizeJoinToken(token);
  if (!normalized) return { ok: false };
  try {
    const admin = createAdminClient();
    const hash = hashJoinToken(normalized, joinKey());
    if (!hash) return { ok: false };
    const { data, error } = await admin
      .from("event_join_links")
      .select("event_id, role, expires_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (isMissingRelation(error) || error || !data) return { ok: false };
    if (Date.parse(data.expires_at as string) <= Date.now()) return { ok: false };
    const role = data.role === "host" || data.role === "guest" ? data.role : null;
    if (!role) return { ok: false };
    const name = await eventName(admin, data.event_id as string);
    let code: string | null = null;
    if (role === "host") {
      try {
        code = (await getJoinCode(data.event_id as string, null)).code;
      } catch {
        code = null;
      }
    }
    return {
      ok: true,
      role,
      eventName: name,
      pageUrl: joinLinkUrl(siteOrigin(), normalized),
      schemeUrl: appJoinScheme(normalized),
      code,
      storeUrl: await appUrl(admin),
    };
  } catch {
    return { ok: false };
  }
}

async function existingLinkRole(
  admin: Admin,
  eventId: string,
  userId: string,
  accountType: "staff" | "client" | "event_guest" | null,
  clientId: string | null,
): Promise<LinkRole | null> {
  if (accountType === "client" && clientId) {
    const { anchorId, links } = await loadLinks(admin, eventId);
    if (linkFor(links, clientId) || anchorId === clientId) return "host";
  }
  const { data, error } = await admin
    .from("event_app_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("auth_user_id", userId)
    .maybeSingle();
  assertNoMissing(error);
  if (error) throw new AccessError(500, "Could not check that link.");
  if (data?.role === "host" || data?.role === "guest") return data.role;
  if (accountType === "event_guest") {
    const { data: acct } = await admin.from("accounts").select("event_guest_id").eq("auth_user_id", userId).maybeSingle();
    const guestId = (acct?.event_guest_id as string | null) ?? null;
    if (guestId) {
      const { data: guest } = await admin
        .from("event_guests")
        .select("id")
        .eq("id", guestId)
        .eq("event_id", eventId)
        .maybeSingle();
      if (guest) return "guest";
    }
  }
  return null;
}

async function grantHostLink(
  admin: Admin,
  args: {
    eventId: string;
    userId: string;
    accountType: "staff" | "client" | "event_guest" | null;
    clientId: string | null;
    email: string | null;
    phone: string | null;
    displayName: string | null;
  },
) {
  if (args.accountType === "event_guest") {
    await rememberMember(admin, args.eventId, args.userId, "host");
    return;
  }
  await linkJoiner(admin, {
    eventId: args.eventId,
    userId: args.userId,
    clientId: args.clientId,
    email: args.email,
    phone: args.phone,
    displayName: args.displayName,
  });
}

async function grantGuestLink(
  admin: Admin,
  args: {
    eventId: string;
    userId: string;
    accountType: "staff" | "client" | "event_guest" | null;
    email: string | null;
    displayName: string | null;
  },
) {
  if (!args.accountType) {
    const guestId = await insertGuestRoster(admin, args);
    const { error: acctErr } = await admin.from("accounts").insert({
      auth_user_id: args.userId,
      account_type: "event_guest",
      event_guest_id: guestId,
      email: args.email,
      updated_at: new Date().toISOString(),
    });
    if (acctErr) throw new AccessError(500, "Could not add you to the event.");
  } else {
    await insertGuestRoster(admin, args);
  }
  await rememberMember(admin, args.eventId, args.userId, "guest");
}

async function insertGuestRoster(
  admin: Admin,
  args: { eventId: string; email: string | null; displayName: string | null },
): Promise<string> {
  if (args.email) {
    const { data: existing } = await admin.from("event_guests").select("id, email").eq("event_id", args.eventId);
    const found = (existing ?? []).find((row) => (row.email ?? "").toLowerCase() === args.email);
    if (found?.id) return found.id as string;
  }
  const parts = splitPersonName(args.displayName);
  const { data, error } = await admin
    .from("event_guests")
    .insert({
      event_id: args.eventId,
      first_name: parts.first,
      last_name: parts.last,
      email: args.email,
      relationship: "Guest",
    })
    .select("id")
    .single();
  if (error || !data) throw new AccessError(500, "Could not add you to the event.");
  return data.id as string;
}

export async function redeemJoinLink(args: {
  userId: string;
  accountType: "staff" | "client" | "event_guest" | null;
  clientId: string | null;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  rawToken: string;
  ip: string | null;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const admin = createAdminClient();
  const since = new Date(now - 60 * 60 * 1000).toISOString();
  const [{ data: userRows, error: userErr }, { data: ipRows, error: ipErr }] = await Promise.all([
    admin
      .from("event_join_attempts")
      .select("created_at")
      .eq("auth_user_id", args.userId)
      .eq("success", false)
      .gte("created_at", since),
    args.ip
      ? admin.from("event_join_attempts").select("created_at").eq("ip", args.ip).eq("success", false).gte("created_at", since)
      : Promise.resolve({ data: [] as { created_at: string }[], error: null }),
  ]);
  assertNoMissing(userErr ?? ipErr);
  if (userErr || ipErr) throw new AccessError(500, "Could not check that link.");

  const tokenHash = hashJoinToken(args.rawToken, joinKey());
  let match: { eventId: string; role: LinkRole; expiresAt: number } | null = null;
  if (tokenHash) {
    const { data, error } = await admin
      .from("event_join_links")
      .select("event_id, role, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    assertNoMissing(error);
    if (error) throw new AccessError(500, "Could not check that link.");
    if (data && (data.role === "host" || data.role === "guest")) {
      match = { eventId: data.event_id as string, role: data.role, expiresAt: Date.parse(data.expires_at as string) };
    }
  }

  const existingRole = match
    ? await existingLinkRole(admin, match.eventId, args.userId, args.accountType, args.clientId)
    : null;
  const decision = evaluateLinkRedeem({
    accountType: args.accountType,
    rawToken: args.rawToken,
    now,
    userFailures: (userRows ?? []).map((row) => Date.parse(row.created_at as string)),
    ipFailures: (ipRows ?? []).map((row) => Date.parse(row.created_at as string)),
    match,
    existingRole,
  });

  if (!decision.ok) {
    if (decision.countFailure) {
      await admin.from("event_join_attempts").insert({
        auth_user_id: args.userId,
        ip: args.ip,
        code_hash: tokenHash,
        event_id: match?.eventId ?? null,
        success: false,
        attempt_kind: "link",
      });
    }
    throw new AccessError(decision.status, decision.error, decision.retryAfterSec);
  }

  if (!decision.alreadyMember) {
    if (decision.role === "host") {
      await grantHostLink(admin, {
        eventId: decision.eventId,
        userId: args.userId,
        accountType: args.accountType,
        clientId: args.clientId,
        email: normalizeEmail(args.email),
        phone: args.phone,
        displayName: args.displayName,
      });
    } else {
      await grantGuestLink(admin, {
        eventId: decision.eventId,
        userId: args.userId,
        accountType: args.accountType,
        email: normalizeEmail(args.email),
        displayName: args.displayName,
      });
    }
  }

  await admin.from("event_join_attempts").insert({
    auth_user_id: args.userId,
    ip: args.ip,
    code_hash: tokenHash,
    event_id: decision.eventId,
    success: true,
    attempt_kind: "link",
  });

  return { ok: true as const, eventId: decision.eventId, role: decision.role, alreadyMember: decision.alreadyMember };
}
