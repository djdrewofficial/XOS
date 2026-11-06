/** Mobile and staff moderation against event content. Permission decisions live
    in ugcModeration.ts. Writes that go through the service role are checked
    there first. Direct table updates still hit the 00214 triggers. */

import "server-only";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { bearerToken, lookupMobileAccountKind, requireMobileUser, type MobileCaller } from "@/lib/mobileCouple";
import { resolveEventRole, type PlannerRole } from "@/lib/planning";
import { dispatchNotification } from "@/lib/notify";
import {
  CONTENT_TYPE_LABELS,
  SHARED_CONTENT,
  UGC_ERRORS,
  accessAfterGuestRemoval,
  canHideContent,
  canRemoveGuest,
  contentVisible,
  hasEventAccess,
  hideDeniedMessage,
  isMissingModerationSchema,
  isUuid,
  labelsForModeration,
  memberRoleFromFacts,
  notesForViewer,
  parseHideBody,
  parseReportBody,
  textForViewer,
  type AccessFacts,
  type ContentType,
  type MemberRole,
  type ModerationPerson,
  type RoleFacts,
} from "@/lib/ugcModeration";

type Admin = ReturnType<typeof createAdminClient>;

function userClient(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

type Gate =
  | { caller: MobileCaller; role: PlannerRole; rls: SupabaseClient }
  | NextResponse;

async function gate(req: Request, eventId: string): Promise<Gate> {
  if (!isUuid(eventId)) return json({ error: UGC_ERRORS.eventNotFound }, 404);
  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;
  const rls = userClient(bearerToken(req));
  const accountType = await lookupMobileAccountKind(rls, caller.userId);
  if (!accountType) return json({ error: UGC_ERRORS.noAccess }, 403);
  const role = await resolveEventRole(rls, caller.userId, accountType, eventId);
  if (!role) return json({ error: UGC_ERRORS.noAccess }, 403);
  return { caller, role, rls };
}

async function roleFacts(admin: Admin, eventId: string, userId: string): Promise<RoleFacts> {
  const { data: acct } = await admin
    .from("accounts")
    .select("account_type, client_id, event_guest_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const accountType = (acct?.account_type as RoleFacts["accountType"]) ?? null;
  const [{ data: member }, { data: event }] = await Promise.all([
    admin.from("event_app_members").select("role").eq("event_id", eventId).eq("auth_user_id", userId).maybeSingle(),
    admin.from("events").select("client_id").eq("id", eventId).maybeSingle(),
  ]);
  let clientOnEvent = false;
  if (accountType === "client" && acct?.client_id) {
    if (event?.client_id === acct.client_id) clientOnEvent = true;
    else {
      const { data: link } = await admin
        .from("event_clients")
        .select("id")
        .eq("event_id", eventId)
        .eq("client_id", acct.client_id)
        .maybeSingle();
      clientOnEvent = Boolean(link);
    }
  }
  let legacyGuest = false;
  if (accountType === "event_guest" && acct?.event_guest_id) {
    const { data: guest } = await admin
      .from("event_guests")
      .select("id")
      .eq("id", acct.event_guest_id)
      .eq("event_id", eventId)
      .maybeSingle();
    legacyGuest = Boolean(guest);
  }
  const appRole = member?.role === "host" || member?.role === "guest" ? member.role : null;
  return { accountType, clientOnEvent, appRole, legacyGuest };
}

/** Names for user ids the caller already has on this event. Other events' clients are not read. */
export async function moderationPeople(
  admin: Admin,
  eventId: string,
  userIds: string[],
  viewerRole: MemberRole,
): Promise<ModerationPerson[]> {
  const ids = [...new Set(userIds.filter((id) => isUuid(id)))];
  if (!ids.length) return [];
  const { data: accountRows } = await admin
    .from("accounts")
    .select("auth_user_id, account_type, client_id, event_guest_id, employee_id")
    .in("auth_user_id", ids);
  const accounts = (accountRows ?? []) as {
    auth_user_id: string;
    account_type: RoleFacts["accountType"];
    client_id: string | null;
    event_guest_id: string | null;
    employee_id: string | null;
  }[];
  const guestIds = accounts.map((row) => row.event_guest_id).filter((id): id is string => Boolean(id));
  const [{ data: event }, { data: links }, { data: guests }, { data: members }] = await Promise.all([
    admin.from("events").select("client_id").eq("id", eventId).maybeSingle(),
    admin.from("event_clients").select("client_id").eq("event_id", eventId),
    guestIds.length
      ? admin.from("event_guests").select("id, first_name, last_name").eq("event_id", eventId).in("id", guestIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
    admin.from("event_app_members").select("auth_user_id, role").eq("event_id", eventId).in("auth_user_id", ids),
  ]);
  const eventClientIds = new Set<string>();
  if (event?.client_id) eventClientIds.add(event.client_id as string);
  for (const link of links ?? []) {
    if (link.client_id) eventClientIds.add(link.client_id as string);
  }
  const clientIds = accounts
    .map((row) => row.client_id)
    .filter((id): id is string => Boolean(id && eventClientIds.has(id)));
  const employeeIds =
    viewerRole === "guest"
      ? []
      : accounts.map((row) => row.employee_id).filter((id): id is string => Boolean(id));
  const [{ data: clients }, { data: employees }] = await Promise.all([
    clientIds.length
      ? admin.from("clients").select("id, first_name, last_name").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
    employeeIds.length
      ? admin.from("employees").select("id, first_name, last_name").in("id", employeeIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
  ]);
  const guestById = new Map((guests ?? []).map((row) => [row.id as string, row]));
  const clientById = new Map((clients ?? []).map((row) => [row.id as string, row]));
  const employeeById = new Map((employees ?? []).map((row) => [row.id as string, row]));
  const appRoleByUser = new Map(
    (members ?? []).map((row) => [row.auth_user_id as string, row.role as "host" | "guest"]),
  );
  const accountByUser = new Map(accounts.map((row) => [row.auth_user_id, row]));
  return labelsForModeration(
    viewerRole,
    ids.map((userId) => {
      const account = accountByUser.get(userId);
      const guest = account?.event_guest_id ? guestById.get(account.event_guest_id) : undefined;
      const clientOnEvent = Boolean(account?.client_id && eventClientIds.has(account.client_id));
      const role = memberRoleFromFacts({
        accountType: account?.account_type ?? null,
        clientOnEvent,
        appRole: appRoleByUser.get(userId) ?? null,
        legacyGuest: Boolean(guest),
      });
      const client = clientOnEvent && account?.client_id ? clientById.get(account.client_id) : undefined;
      const employee = account?.employee_id ? employeeById.get(account.employee_id) : undefined;
      return {
        userId,
        role,
        clientFirstName: (client?.first_name as string | null) ?? null,
        clientLastName: (client?.last_name as string | null) ?? null,
        guestFirstName: (guest?.first_name as string | null) ?? null,
        guestLastName: (guest?.last_name as string | null) ?? null,
        staffFirstName: (employee?.first_name as string | null) ?? null,
        staffLastName: (employee?.last_name as string | null) ?? null,
      };
    }),
  );
}

function toAccess(facts: RoleFacts): AccessFacts {
  return {
    staff: facts.accountType === "staff",
    clientOnEvent: facts.clientOnEvent,
    appRole: facts.appRole,
    legacyGuest: facts.legacyGuest,
  };
}

async function blockedSet(rls: SupabaseClient, eventId: string, userId: string, role: MemberRole): Promise<Set<string>> {
  if (role === "staff") return new Set();
  const { data, error } = await rls
    .from("event_member_blocks")
    .select("blocked_id")
    .eq("event_id", eventId)
    .eq("blocker_id", userId);
  if (error || !data) return new Set();
  return new Set(data.map((row) => row.blocked_id as string));
}

type Target = {
  authorId: string | null;
  label: string;
};

async function lookupTarget(
  admin: Admin,
  eventId: string,
  targetType: ContentType,
  targetId: string | null,
  targetUserId: string | null,
): Promise<Target | null> {
  if (targetType === "user") {
    if (!targetUserId) return null;
    const facts = await roleFacts(admin, eventId, targetUserId);
    if (!memberRoleFromFacts(facts)) return null;
    return { authorId: targetUserId, label: "Person" };
  }
  if (targetType === "song" && targetId) {
    const { data } = await admin
      .from("planning_songs")
      .select("id, title, artist, requested_by")
      .eq("id", targetId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!data) return null;
    const label = [data.title, data.artist].filter(Boolean).join(" - ") || "Song request";
    return { authorId: (data.requested_by as string | null) ?? null, label };
  }
  if (targetType === "song_like" && targetId && targetUserId) {
    const { data: song } = await admin
      .from("planning_songs")
      .select("id")
      .eq("id", targetId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!song) return null;
    const { data: like } = await admin
      .from("planning_song_likes")
      .select("account_id")
      .eq("song_id", targetId)
      .eq("account_id", targetUserId)
      .maybeSingle();
    if (!like) return null;
    return { authorId: targetUserId, label: "Song like" };
  }
  if (targetType === "answer" && targetId) {
    const { data } = await admin
      .from("planning_question_answers")
      .select("question_id, answer, answered_by")
      .eq("question_id", targetId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!data) return null;
    return { authorId: (data.answered_by as string | null) ?? null, label: (data.answer as string) || "Planning answer" };
  }
  if (targetType === "section_note" && targetId) {
    const { data } = await admin
      .from("planning_sections")
      .select("id, title, client_notes, client_notes_updated_by")
      .eq("id", targetId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!data) return null;
    return {
      authorId: (data.client_notes_updated_by as string | null) ?? null,
      label: (data.title as string) || "Planning note",
    };
  }
  if (targetType === "do_not_play_note" && targetId === eventId) {
    const { data } = await admin
      .from("planning_do_not_play_notes")
      .select("body, updated_by")
      .eq("event_id", eventId)
      .maybeSingle();
    if (!data) return null;
    return { authorId: (data.updated_by as string | null) ?? null, label: "Music avoid note" };
  }
  if (targetType === "song_idea" && targetId) {
    const { data } = await admin
      .from("song_ideas")
      .select("id, title, artist, added_by")
      .eq("id", targetId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!data) return null;
    return {
      authorId: (data.added_by as string | null) ?? null,
      label: [data.title, data.artist].filter(Boolean).join(" - ") || "Song idea",
    };
  }
  if (targetType === "cover_photo" && targetId === eventId) {
    const { data } = await admin
      .from("events")
      .select("cover_photo_url, cover_photo_updated_by")
      .eq("id", eventId)
      .maybeSingle();
    if (!data?.cover_photo_url) return null;
    return { authorId: (data.cover_photo_updated_by as string | null) ?? null, label: "Cover photo" };
  }
  if (targetType === "booth_selection" && targetId === eventId) {
    const { data } = await admin
      .from("event_photobooth_selection")
      .select("event_id, updated_by")
      .eq("event_id", eventId)
      .maybeSingle();
    if (!data) return null;
    return { authorId: (data.updated_by as string | null) ?? null, label: "Photo booth choice" };
  }
  if (targetType === "timeline_file" && targetId) {
    const { data } = await admin
      .from("event_files")
      .select("id, name, uploaded_by, source")
      .eq("id", targetId)
      .eq("event_id", eventId)
      .eq("source", "planner_timeline")
      .maybeSingle();
    if (!data) return null;
    return { authorId: (data.uploaded_by as string | null) ?? null, label: (data.name as string) || "Planner timeline" };
  }
  return null;
}

function reportRow(row: {
  id: string;
  target_type: string;
  target_id: string | null;
  target_user_id: string | null;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
}) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetUserId: row.target_user_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listMyReports(req: Request, eventId: string): Promise<NextResponse> {
  const who = await gate(req, eventId);
  if (who instanceof NextResponse) return who;
  const { data, error } = await who.rls
    .from("event_content_reports")
    .select("id, target_type, target_id, target_user_id, reason, details, status, created_at")
    .eq("event_id", eventId)
    .eq("reporter_id", who.caller.userId)
    .order("created_at", { ascending: false });
  if (isMissingModerationSchema(error)) return json({ error: UGC_ERRORS.unavailable }, 503);
  if (error) return json({ error: UGC_ERRORS.unavailable }, 500);
  return json({ reports: (data ?? []).map((row) => reportRow(row as Parameters<typeof reportRow>[0])) }, 200);
}

export async function createReport(req: Request, eventId: string): Promise<NextResponse> {
  const who = await gate(req, eventId);
  if (who instanceof NextResponse) return who;
  const parsed = parseReportBody(await req.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const value = parsed.value;
  if (value.targetType === "user" && value.targetUserId === who.caller.userId) {
    return json({ error: UGC_ERRORS.selfReport }, 400);
  }
  const admin = createAdminClient();
  let target: Target | null = null;
  try {
    target = await lookupTarget(admin, eventId, value.targetType, value.targetId, value.targetUserId);
  } catch (err) {
    const error = err as { code?: string; message?: string };
    if (isMissingModerationSchema(error)) return json({ error: UGC_ERRORS.unavailable }, 503);
    throw err;
  }
  if (!target) return json({ error: UGC_ERRORS.notFound }, 404);

  const insert = {
    event_id: eventId,
    reporter_id: who.caller.userId,
    target_type: value.targetType,
    target_id: value.targetId,
    target_user_id: value.targetType === "user" ? value.targetUserId : target.authorId,
    reason: value.reason,
    details: value.details,
  };
  const { data, error } = await who.rls
    .from("event_content_reports")
    .insert(insert)
    .select("id, target_type, target_id, target_user_id, reason, details, status, created_at")
    .maybeSingle();
  if (isMissingModerationSchema(error)) return json({ error: UGC_ERRORS.unavailable }, 503);
  if (error?.code === "23505") {
    const { data: existing } = await who.rls
      .from("event_content_reports")
      .select("id, target_type, target_id, target_user_id, reason, details, status, created_at")
      .eq("event_id", eventId)
      .eq("reporter_id", who.caller.userId)
      .eq("target_type", value.targetType)
      .eq("status", "open")
      .order("created_at", { ascending: false });
    const match = (existing ?? []).find((row) => {
      const sameId = (row.target_id ?? null) === (value.targetId ?? null);
      const sameUser = (row.target_user_id ?? null) === (insert.target_user_id ?? null);
      return sameId && sameUser;
    });
    if (!match) return json({ error: UGC_ERRORS.unavailable }, 409);
    return json({ ...reportRow(match as Parameters<typeof reportRow>[0]), alreadyReported: true }, 200);
  }
  if (error) {
    const status = error.code === "42501" ? 403 : 500;
    return json({ error: status === 403 ? UGC_ERRORS.noAccess : UGC_ERRORS.unavailable }, status);
  }
  if (!data) return json({ error: UGC_ERRORS.noAccess }, 403);
  await dispatchNotification(admin, "content_report", { eventId });
  return json({ ...reportRow(data as Parameters<typeof reportRow>[0]), alreadyReported: false }, 201);
}

export async function listBlocks(req: Request, eventId: string): Promise<NextResponse> {
  const who = await gate(req, eventId);
  if (who instanceof NextResponse) return who;
  const { data, error } = await who.rls
    .from("event_member_blocks")
    .select("blocked_id")
    .eq("event_id", eventId)
    .eq("blocker_id", who.caller.userId);
  if (isMissingModerationSchema(error)) return json({ error: UGC_ERRORS.unavailable }, 503);
  if (error) return json({ error: UGC_ERRORS.unavailable }, 500);
  const blockedUserIds = (data ?? []).map((row) => row.blocked_id as string);
  const blocked = blockedUserIds.length
    ? await moderationPeople(createAdminClient(), eventId, blockedUserIds, who.role)
    : [];
  return json({ blockedUserIds, blocked }, 200);
}

async function blockPersonFields(who: { rls: SupabaseClient; caller: MobileCaller; role: MemberRole }, eventId: string, userId: string) {
  const { data } = await who.rls
    .from("event_member_blocks")
    .select("blocked_id")
    .eq("event_id", eventId)
    .eq("blocker_id", who.caller.userId);
  const ids = (data ?? []).map((row) => row.blocked_id as string);
  if (!ids.includes(userId)) ids.push(userId);
  const people = await moderationPeople(createAdminClient(), eventId, ids, who.role);
  return people.find((person) => person.userId === userId) ?? { userId, displayName: null, label: "Guest", role: null };
}

export async function createBlock(req: Request, eventId: string): Promise<NextResponse> {
  const who = await gate(req, eventId);
  if (who instanceof NextResponse) return who;
  const body = await req.json().catch(() => null);
  const userId = body && typeof body === "object" ? (body as { userId?: unknown }).userId : null;
  if (!isUuid(userId)) return json({ error: UGC_ERRORS.userId }, 400);
  if (userId === who.caller.userId) return json({ error: UGC_ERRORS.selfBlock }, 400);
  const admin = createAdminClient();
  const facts = await roleFacts(admin, eventId, userId);
  const targetRole = memberRoleFromFacts(facts);
  if (!targetRole || targetRole === "staff") return json({ error: UGC_ERRORS.notFound }, 404);
  const { error } = await who.rls.from("event_member_blocks").insert({
    event_id: eventId,
    blocker_id: who.caller.userId,
    blocked_id: userId,
  });
  if (isMissingModerationSchema(error)) return json({ error: UGC_ERRORS.unavailable }, 503);
  if (error && error.code !== "23505") {
    const status = error.code === "42501" ? 403 : 500;
    return json({ error: status === 403 ? UGC_ERRORS.noAccess : UGC_ERRORS.unavailable }, status);
  }
  const person = await blockPersonFields(who, eventId, userId);
  return json(
    { ok: true, userId, alreadyBlocked: error?.code === "23505", displayName: person.displayName, label: person.label, role: person.role },
    error?.code === "23505" ? 200 : 201,
  );
}

export async function deleteBlock(req: Request, eventId: string, userId: string): Promise<NextResponse> {
  const who = await gate(req, eventId);
  if (who instanceof NextResponse) return who;
  if (!isUuid(userId)) return json({ error: UGC_ERRORS.notFound }, 404);
  const { data, error } = await who.rls
    .from("event_member_blocks")
    .delete()
    .eq("event_id", eventId)
    .eq("blocker_id", who.caller.userId)
    .eq("blocked_id", userId)
    .select("blocked_id");
  if (isMissingModerationSchema(error)) return json({ error: UGC_ERRORS.unavailable }, 503);
  if (error) return json({ error: UGC_ERRORS.unavailable }, 500);
  if (!data?.length) return json({ error: UGC_ERRORS.notFound }, 404);
  return json({ ok: true, userId }, 200);
}

export async function hideContent(req: Request, eventId: string): Promise<NextResponse> {
  const who = await gate(req, eventId);
  if (who instanceof NextResponse) return who;
  const parsed = parseHideBody(await req.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { targetType, targetId, targetUserId } = parsed.value;
  const admin = createAdminClient();
  const target = await lookupTarget(admin, eventId, targetType, targetId, targetUserId);
  if (!target) return json({ error: UGC_ERRORS.notFound }, 404);
  const authorRole = target.authorId ? memberRoleFromFacts(await roleFacts(admin, eventId, target.authorId)) : null;
  const decision = canHideContent({
    actorRole: who.role,
    actorId: who.caller.userId,
    authorId: target.authorId,
    authorRole,
    shared: SHARED_CONTENT.has(targetType),
  });
  if (decision !== "ok") return json({ error: hideDeniedMessage(who.role) }, 403);

  const hiddenAt = new Date().toISOString();
  const patch = { hidden_at: hiddenAt, hidden_by: who.caller.userId };
  let error: { code?: string; message?: string } | null = null;
  if (targetType === "song") {
    ({ error } = await admin.from("planning_songs").update(patch).eq("id", targetId).eq("event_id", eventId));
  } else if (targetType === "song_like" && targetUserId) {
    ({ error } = await admin.from("planning_song_likes").update(patch).eq("song_id", targetId).eq("account_id", targetUserId));
  } else if (targetType === "answer") {
    ({ error } = await admin.from("planning_question_answers").update(patch).eq("question_id", targetId).eq("event_id", eventId));
  } else if (targetType === "section_note") {
    ({ error } = await admin
      .from("planning_sections")
      .update({ client_notes_hidden_at: hiddenAt, client_notes_hidden_by: who.caller.userId })
      .eq("id", targetId)
      .eq("event_id", eventId));
  } else if (targetType === "do_not_play_note") {
    ({ error } = await admin.from("planning_do_not_play_notes").update(patch).eq("event_id", eventId));
  } else if (targetType === "song_idea") {
    ({ error } = await admin.from("song_ideas").update(patch).eq("id", targetId).eq("event_id", eventId));
  } else if (targetType === "cover_photo") {
    ({ error } = await admin
      .from("events")
      .update({ cover_photo_hidden_at: hiddenAt, cover_photo_hidden_by: who.caller.userId })
      .eq("id", eventId));
  } else if (targetType === "booth_selection") {
    ({ error } = await admin.from("event_photobooth_selection").update(patch).eq("event_id", eventId));
  } else if (targetType === "timeline_file") {
    ({ error } = await admin
      .from("event_files")
      .update(patch)
      .eq("id", targetId)
      .eq("event_id", eventId)
      .eq("source", "planner_timeline"));
  }
  if (isMissingModerationSchema(error)) return json({ error: UGC_ERRORS.unavailable }, 503);
  if (error) return json({ error: UGC_ERRORS.unavailable }, 500);
  return json({ ok: true, targetType, targetId, hiddenAt }, 200);
}

export async function removeGuest(req: Request, eventId: string, userId: string): Promise<NextResponse> {
  const who = await gate(req, eventId);
  if (who instanceof NextResponse) return who;
  if (who.role === "guest") return json({ error: UGC_ERRORS.noAccess }, 403);
  if (!isUuid(userId)) return json({ error: UGC_ERRORS.guestNotFound }, 404);
  const admin = createAdminClient();
  const facts = await roleFacts(admin, eventId, userId);
  const access = toAccess(facts);
  const decision = canRemoveGuest(who.role, access);
  if (decision === "not_found") return json({ error: UGC_ERRORS.guestNotFound }, 404);
  if (decision === "forbidden") return json({ error: UGC_ERRORS.onlyGuest }, 403);
  const after = accessAfterGuestRemoval(access);
  const { data, error } = await admin
    .from("event_app_members")
    .delete()
    .eq("event_id", eventId)
    .eq("auth_user_id", userId)
    .eq("role", "guest")
    .select("auth_user_id");
  if (isMissingModerationSchema(error)) return json({ error: UGC_ERRORS.unavailable }, 503);
  if (error) return json({ error: UGC_ERRORS.unavailable }, 500);
  if (!data?.length) return json({ error: UGC_ERRORS.guestNotFound }, 404);
  return json({ ok: true, userId, access: hasEventAccess(after) ? "other" : "none" }, 200);
}

function withHidden<T extends { hidden: boolean }>(rows: T[], role: MemberRole): T[] {
  if (role === "staff") return rows;
  return rows.filter((row) => !row.hidden);
}

export async function listEventContent(req: Request, eventId: string): Promise<NextResponse> {
  const who = await gate(req, eventId);
  if (who instanceof NextResponse) return who;
  const blocked = await blockedSet(who.rls, eventId, who.caller.userId, who.role);
  const admin = createAdminClient();
  const [songsRes, likesRes, answersRes, sectionsRes, avoidRes, ideasRes, coverRes, boothRes, fileRes] = await Promise.all([
    who.rls
      .from("planning_songs")
      .select("id, section_id, title, artist, note, requested_by, must_play, do_not_play, sort_order, hidden_at")
      .eq("event_id", eventId)
      .order("sort_order"),
    who.rls.from("planning_song_likes").select("song_id, account_id, hidden_at, planning_songs!inner(event_id)").eq("planning_songs.event_id", eventId),
    who.rls.from("planning_question_answers").select("question_id, answer, answered_by, hidden_at").eq("event_id", eventId),
    who.rls.from("planning_sections").select("id, client_notes, client_notes_updated_by, client_notes_hidden_at").eq("event_id", eventId),
    who.role === "guest"
      ? Promise.resolve({ data: null, error: null })
      : who.rls.from("planning_do_not_play_notes").select("body, updated_by, hidden_at").eq("event_id", eventId).maybeSingle(),
    who.rls.from("song_ideas").select("id, title, artist, note, added_by, hidden_at").eq("event_id", eventId),
    admin.from("events").select("cover_photo_url, cover_photo_updated_by, cover_photo_hidden_at").eq("id", eventId).maybeSingle(),
    who.rls.from("event_photobooth_selection").select("backdrop_id, updated_by, hidden_at").eq("event_id", eventId).maybeSingle(),
    who.rls
      .from("event_files")
      .select("id, name, uploaded_by, hidden_at, created_at")
      .eq("event_id", eventId)
      .eq("source", "planner_timeline")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const songs = withHidden(
    (songsRes.data ?? [])
      .filter((row) =>
        contentVisible({
          viewerRole: who.role,
          authorId: (row.requested_by as string | null) ?? null,
          hidden: Boolean(row.hidden_at),
          blockedAuthorIds: blocked,
        }),
      )
      .map((row) => ({
        id: row.id as string,
        sectionId: row.section_id as string,
        title: (row.title as string) ?? "",
        artist: (row.artist as string | null) ?? null,
        note: (row.note as string | null) ?? null,
        requestedBy: (row.requested_by as string | null) ?? null,
        mustPlay: Boolean(row.must_play),
        doNotPlay: Boolean(row.do_not_play),
        sortOrder: (row.sort_order as number) ?? 0,
        hidden: Boolean(row.hidden_at),
      })),
    who.role,
  );

  const visibleSongIds = new Set(songs.map((song) => song.id));
  const likes = withHidden(
    (likesRes.data ?? [])
      .filter((row) => visibleSongIds.has(row.song_id as string) || who.role === "staff")
      .filter((row) =>
        contentVisible({
          viewerRole: who.role,
          authorId: (row.account_id as string | null) ?? null,
          hidden: Boolean(row.hidden_at),
          blockedAuthorIds: blocked,
        }),
      )
      .map((row) => ({
        songId: row.song_id as string,
        userId: row.account_id as string,
        hidden: Boolean(row.hidden_at),
      })),
    who.role,
  );
  const likeCount = new Map<string, number>();
  for (const like of likes) {
    if (like.hidden && who.role !== "staff") continue;
    if (!like.hidden) likeCount.set(like.songId, (likeCount.get(like.songId) ?? 0) + 1);
  }

  const sectionNotes = (sectionsRes.data ?? [])
    .map((row) => {
      const viewed = notesForViewer(
        (row.client_notes as string | null) ?? null,
        (row.client_notes_updated_by as string | null) ?? null,
        Boolean(row.client_notes_hidden_at),
        who.role,
        blocked,
      );
      return {
        sectionId: row.id as string,
        notes: viewed.notes,
        updatedBy: (row.client_notes_updated_by as string | null) ?? null,
        hidden: Boolean(viewed.hidden),
      };
    })
    .filter((row) => row.notes != null || row.hidden);

  const avoidRow = avoidRes.data as { body?: string | null; updated_by?: string | null; hidden_at?: string | null } | null;
  const avoid = avoidRow
    ? textForViewer(
        avoidRow.body ?? null,
        avoidRow.updated_by ?? null,
        Boolean(avoidRow.hidden_at),
        who.role,
        blocked,
      )
    : null;

  const coverRow = coverRes.data as {
    cover_photo_url?: string | null;
    cover_photo_updated_by?: string | null;
    cover_photo_hidden_at?: string | null;
  } | null;
  let coverPhoto: { url: string | null; updatedBy: string | null; hidden: boolean } | null = null;
  if (coverRow?.cover_photo_url || coverRow?.cover_photo_hidden_at) {
    const viewed = textForViewer(
      coverRow.cover_photo_url ?? null,
      coverRow.cover_photo_updated_by ?? null,
      Boolean(coverRow.cover_photo_hidden_at),
      who.role,
      blocked,
    );
    if (viewed.text || viewed.hidden) {
      coverPhoto = { url: viewed.text, updatedBy: coverRow.cover_photo_updated_by ?? null, hidden: Boolean(viewed.hidden) };
    }
  }

  const boothRow = boothRes.data as { backdrop_id?: string | null; updated_by?: string | null; hidden_at?: string | null } | null;
  const boothVisible =
    boothRow &&
    contentVisible({
      viewerRole: who.role,
      authorId: boothRow.updated_by ?? null,
      hidden: Boolean(boothRow.hidden_at),
      blockedAuthorIds: blocked,
    });

  if (
    [songsRes.error, likesRes.error, answersRes.error, sectionsRes.error, ideasRes.error].some((item) =>
      isMissingModerationSchema(item),
    )
  ) {
    return json({ error: UGC_ERRORS.unavailable }, 503);
  }

  const file = (fileRes.data ?? [])[0] as
    | { id: string; name: string | null; uploaded_by: string | null; hidden_at: string | null }
    | undefined;
  const fileVisible =
    file &&
    contentVisible({
      viewerRole: who.role,
      authorId: file.uploaded_by,
      hidden: Boolean(file.hidden_at),
      blockedAuthorIds: blocked,
    });

  const body = {
      songs: songs.map((song) => ({
        ...song,
        likeCount: likeCount.get(song.id) ?? 0,
        likedByMe: likes.some((like) => like.songId === song.id && like.userId === who.caller.userId && !like.hidden),
      })),
      likes,
      answers: withHidden(
        (answersRes.data ?? [])
          .filter((row) =>
            contentVisible({
              viewerRole: who.role,
              authorId: (row.answered_by as string | null) ?? null,
              hidden: Boolean(row.hidden_at),
              blockedAuthorIds: blocked,
            }),
          )
          .map((row) => ({
            questionId: row.question_id as string,
            answer: (row.answer as string | null) ?? null,
            answeredBy: (row.answered_by as string | null) ?? null,
            hidden: Boolean(row.hidden_at),
          })),
        who.role,
      ),
      sectionNotes,
      doNotPlayNotes: avoid
        ? { text: avoid.text, updatedBy: avoidRow?.updated_by ?? null, hidden: Boolean(avoid.hidden) }
        : null,
      songIdeas: withHidden(
        (ideasRes.data ?? [])
          .filter((row) =>
            contentVisible({
              viewerRole: who.role,
              authorId: (row.added_by as string | null) ?? null,
              hidden: Boolean(row.hidden_at),
              blockedAuthorIds: blocked,
            }),
          )
          .map((row) => ({
            id: row.id as string,
            title: (row.title as string) ?? "",
            artist: (row.artist as string | null) ?? null,
            note: (row.note as string | null) ?? null,
            addedBy: (row.added_by as string | null) ?? null,
            hidden: Boolean(row.hidden_at),
          })),
        who.role,
      ),
      coverPhoto,
      boothSelection:
        boothRow && boothVisible
          ? {
              backdropId: (boothRow.backdrop_id as string | null) ?? null,
              updatedBy: boothRow.updated_by ?? null,
              hidden: Boolean(boothRow.hidden_at),
            }
          : null,
      timelineFile:
        file && fileVisible
          ? { id: file.id, name: file.name, uploadedBy: file.uploaded_by, hidden: Boolean(file.hidden_at) }
          : null,
  };
  const authorIds = [
    ...body.songs.map((song) => song.requestedBy),
    ...body.likes.map((like) => like.userId),
    ...body.answers.map((answer) => answer.answeredBy),
    ...body.sectionNotes.map((note) => note.updatedBy),
    body.doNotPlayNotes?.updatedBy ?? null,
    ...body.songIdeas.map((idea) => idea.addedBy),
    body.coverPhoto?.updatedBy ?? null,
    body.boothSelection?.updatedBy ?? null,
    body.timelineFile?.uploadedBy ?? null,
  ].filter((id): id is string => Boolean(id));
  const people = authorIds.length ? await moderationPeople(admin, eventId, authorIds, who.role) : [];
  const byId = new Map(people.map((person) => [person.userId, person]));
  const authorLabel = (id: string | null | undefined) => (id ? byId.get(id)?.label ?? null : null);
  return json(
    {
      ...body,
      songs: body.songs.map((song) => ({ ...song, requestedByLabel: authorLabel(song.requestedBy) })),
      likes: body.likes.map((like) => ({
        ...like,
        displayName: byId.get(like.userId)?.displayName ?? null,
        label: byId.get(like.userId)?.label ?? "Guest",
      })),
      answers: body.answers.map((answer) => ({ ...answer, answeredByLabel: authorLabel(answer.answeredBy) })),
      sectionNotes: body.sectionNotes.map((note) => ({ ...note, updatedByLabel: authorLabel(note.updatedBy) })),
      doNotPlayNotes: body.doNotPlayNotes
        ? { ...body.doNotPlayNotes, updatedByLabel: authorLabel(body.doNotPlayNotes.updatedBy) }
        : null,
      songIdeas: body.songIdeas.map((idea) => ({ ...idea, addedByLabel: authorLabel(idea.addedBy) })),
      coverPhoto: body.coverPhoto
        ? { ...body.coverPhoto, updatedByLabel: authorLabel(body.coverPhoto.updatedBy) }
        : null,
      boothSelection: body.boothSelection
        ? { ...body.boothSelection, updatedByLabel: authorLabel(body.boothSelection.updatedBy) }
        : null,
      timelineFile: body.timelineFile
        ? { ...body.timelineFile, uploadedByLabel: authorLabel(body.timelineFile.uploadedBy) }
        : null,
      people,
    },
    200,
  );
}

export type StaffReport = {
  id: string;
  targetType: string;
  targetLabel: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
  targetId: string | null;
  targetUserId: string | null;
};

export type HiddenRow = {
  targetType: Exclude<ContentType, "user">;
  targetId: string;
  targetUserId: string | null;
  label: string;
  hiddenAt: string;
};

export async function loadStaffModeration(
  supabase: SupabaseClient,
  eventId: string,
): Promise<{ setup: true } | { setup: false; reports: StaffReport[]; hidden: HiddenRow[] }> {
  const { data: reports, error } = await supabase
    .from("event_content_reports")
    .select("id, target_type, target_id, target_user_id, reason, details, status, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (isMissingModerationSchema(error)) return { setup: true };
  if (error) return { setup: true };

  const [songs, likes, answers, sections, avoid, ideas, event, booth, files] = await Promise.all([
    supabase.from("planning_songs").select("id, title, artist, requested_by, hidden_at").eq("event_id", eventId).not("hidden_at", "is", null),
    supabase.from("planning_song_likes").select("song_id, account_id, hidden_at, planning_songs!inner(event_id)").eq("planning_songs.event_id", eventId).not("hidden_at", "is", null),
    supabase.from("planning_question_answers").select("question_id, answer, answered_by, hidden_at").eq("event_id", eventId).not("hidden_at", "is", null),
    supabase.from("planning_sections").select("id, title, client_notes_hidden_at, client_notes_updated_by").eq("event_id", eventId).not("client_notes_hidden_at", "is", null),
    supabase.from("planning_do_not_play_notes").select("event_id, updated_by, hidden_at").eq("event_id", eventId).not("hidden_at", "is", null).maybeSingle(),
    supabase.from("song_ideas").select("id, title, artist, added_by, hidden_at").eq("event_id", eventId).not("hidden_at", "is", null),
    supabase.from("events").select("id, cover_photo_hidden_at, cover_photo_updated_by").eq("id", eventId).not("cover_photo_hidden_at", "is", null).maybeSingle(),
    supabase.from("event_photobooth_selection").select("event_id, updated_by, hidden_at").eq("event_id", eventId).not("hidden_at", "is", null).maybeSingle(),
    supabase.from("event_files").select("id, name, uploaded_by, hidden_at").eq("event_id", eventId).eq("source", "planner_timeline").not("hidden_at", "is", null),
  ]);
  if (
    [songs.error, likes.error, answers.error, sections.error, avoid.error, ideas.error, event.error, booth.error, files.error].some(
      (item) => item && isMissingModerationSchema(item),
    )
  ) {
    return { setup: true };
  }

  const hidden: HiddenRow[] = [];
  for (const row of songs.data ?? []) {
    hidden.push({
      targetType: "song",
      targetId: row.id as string,
      targetUserId: (row.requested_by as string | null) ?? null,
      label: [row.title, row.artist].filter(Boolean).join(" - ") || "Song request",
      hiddenAt: row.hidden_at as string,
    });
  }
  for (const row of likes.data ?? []) {
    hidden.push({
      targetType: "song_like",
      targetId: row.song_id as string,
      targetUserId: row.account_id as string,
      label: "Song like",
      hiddenAt: row.hidden_at as string,
    });
  }
  for (const row of answers.data ?? []) {
    hidden.push({
      targetType: "answer",
      targetId: row.question_id as string,
      targetUserId: (row.answered_by as string | null) ?? null,
      label: ((row.answer as string) || "Planning answer").slice(0, 80),
      hiddenAt: row.hidden_at as string,
    });
  }
  for (const row of sections.data ?? []) {
    hidden.push({
      targetType: "section_note",
      targetId: row.id as string,
      targetUserId: (row.client_notes_updated_by as string | null) ?? null,
      label: (row.title as string) || "Planning note",
      hiddenAt: row.client_notes_hidden_at as string,
    });
  }
  if (avoid.data?.hidden_at) {
    hidden.push({
      targetType: "do_not_play_note",
      targetId: eventId,
      targetUserId: (avoid.data.updated_by as string | null) ?? null,
      label: "Music avoid note",
      hiddenAt: avoid.data.hidden_at as string,
    });
  }
  for (const row of ideas.data ?? []) {
    hidden.push({
      targetType: "song_idea",
      targetId: row.id as string,
      targetUserId: (row.added_by as string | null) ?? null,
      label: [row.title, row.artist].filter(Boolean).join(" - ") || "Song idea",
      hiddenAt: row.hidden_at as string,
    });
  }
  if (event.data?.cover_photo_hidden_at) {
    hidden.push({
      targetType: "cover_photo",
      targetId: eventId,
      targetUserId: (event.data.cover_photo_updated_by as string | null) ?? null,
      label: "Cover photo",
      hiddenAt: event.data.cover_photo_hidden_at as string,
    });
  }
  if (booth.data?.hidden_at) {
    hidden.push({
      targetType: "booth_selection",
      targetId: eventId,
      targetUserId: (booth.data.updated_by as string | null) ?? null,
      label: "Photo booth choice",
      hiddenAt: booth.data.hidden_at as string,
    });
  }
  for (const row of files.data ?? []) {
    hidden.push({
      targetType: "timeline_file",
      targetId: row.id as string,
      targetUserId: (row.uploaded_by as string | null) ?? null,
      label: (row.name as string) || "Planner timeline",
      hiddenAt: row.hidden_at as string,
    });
  }

  return {
    setup: false,
    reports: (reports ?? []).map((row) => ({
      id: row.id as string,
      targetType: row.target_type as string,
      targetLabel: CONTENT_TYPE_LABELS[row.target_type as ContentType] ?? (row.target_type as string),
      reason: row.reason as string,
      details: (row.details as string | null) ?? null,
      status: row.status as string,
      createdAt: row.created_at as string,
      targetId: (row.target_id as string | null) ?? null,
      targetUserId: (row.target_user_id as string | null) ?? null,
    })),
    hidden,
  };
}

/** Used by the event card and the notes route, which read through the service
    role and would otherwise skip the block and hide filters. */
export async function viewerBlocks(reqToken: string, eventId: string, userId: string, role: MemberRole): Promise<Set<string>> {
  if (role === "staff" || !reqToken) return new Set();
  const rls = userClient(reqToken);
  return blockedSet(rls, eventId, userId, role);
}
