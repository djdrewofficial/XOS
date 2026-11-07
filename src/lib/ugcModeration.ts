/** Apple guideline 1.2 moderation for event content the couple app shares.
    Pure rules. The database trigger mirrors canHideContent, and the mobile
    routes return these error strings. */

export const REPORT_REASONS = ["offensive", "spam", "harassment", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Content one event member can create that another member can see.
    Community posts are not here: migration 00147 dropped them.
    A song's dedication is the song row's note, not a separate type.
    section_note, do_not_play_note, cover_photo, booth_selection, and
    timeline_file are shared couple fields: either host may hide them. */
export const CONTENT_TYPES = [
  "song",
  "song_like",
  "answer",
  "section_note",
  "do_not_play_note",
  "song_idea",
  "cover_photo",
  "booth_selection",
  "timeline_file",
  "user",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const SHARED_CONTENT = new Set<ContentType>([
  "section_note",
  "do_not_play_note",
  "cover_photo",
  "booth_selection",
  "timeline_file",
]);

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  song: "Song request",
  song_like: "Song like",
  answer: "Planning answer",
  section_note: "Planning note",
  do_not_play_note: "Music avoid note",
  song_idea: "Song idea",
  cover_photo: "Cover photo",
  booth_selection: "Photo booth choice",
  timeline_file: "Planner timeline",
  user: "Person",
};

export const REASON_LABELS: Record<ReportReason, string> = {
  offensive: "Offensive",
  spam: "Spam",
  harassment: "Harassment",
  other: "Other",
};

export const DETAIL_MAX = 1000;

export const UGC_ERRORS = {
  signIn: "Sign in required.",
  noAccess: "You don't have access to that.",
  notFound: "That was not found.",
  eventNotFound: "That event was not found.",
  guestNotFound: "That guest was not found.",
  ownContent: "You can only remove your own content.",
  guestContent: "You can only remove a guest's content or your own.",
  onlyGuest: "Only a guest can be removed.",
  selfBlock: "You can't block yourself.",
  selfReport: "You can't report yourself.",
  unavailable: "Reporting is not available yet.",
  reason: "Reason must be offensive, spam, harassment, or other.",
  targetType: "targetType is not supported.",
  targetId: "targetId is required.",
  targetUser: "targetUserId is required.",
  userId: "userId is required.",
  details: `Details must be ${DETAIL_MAX} characters or fewer.`,
  missing: "Missing fields.",
  userNotHide: "Blocking a person uses the block endpoint. Removing a guest uses the guest endpoint.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export type MemberRole = "staff" | "host" | "guest";

export type RoleFacts = {
  accountType: "staff" | "client" | "event_guest" | null;
  clientOnEvent: boolean;
  appRole: "host" | "guest" | null;
  legacyGuest: boolean;
};

/** Same priority as xos_is_host / xos_guest_of: staff, then host, then guest. */
export function memberRoleFromFacts(facts: RoleFacts): MemberRole | null {
  if (facts.accountType === "staff") return "staff";
  if (facts.clientOnEvent || facts.appRole === "host") return "host";
  if (facts.appRole === "guest" || facts.legacyGuest) return "guest";
  return null;
}

export type AccessFacts = {
  staff: boolean;
  clientOnEvent: boolean;
  appRole: "host" | "guest" | null;
  legacyGuest: boolean;
};

/** True when this person can still open the event in the app. */
export function hasEventAccess(facts: AccessFacts): boolean {
  if (facts.staff || facts.clientOnEvent) return true;
  if (facts.appRole === "host" || facts.appRole === "guest") return true;
  return facts.legacyGuest;
}

/** Drop a guest membership row. Other grants (client on the event, legacy guest) stay. */
export function accessAfterGuestRemoval(before: AccessFacts): AccessFacts {
  if (before.appRole !== "guest") return before;
  return { ...before, appRole: null };
}

export function canRemoveGuest(
  actorRole: MemberRole,
  target: AccessFacts,
): "ok" | "forbidden" | "not_found" {
  if (actorRole === "guest") return "forbidden";
  if (target.appRole !== "guest") return target.appRole ? "forbidden" : "not_found";
  if (target.staff || target.clientOnEvent) return "forbidden";
  return "ok";
}

export function hideDeniedMessage(actorRole: MemberRole): string {
  return actorRole === "host" ? UGC_ERRORS.guestContent : UGC_ERRORS.ownContent;
}

/** Staff can hide anything. A member can hide their own. A host can hide a guest's
    content, unattributed content, and shared couple fields. A host cannot hide
    another host's song, like, answer, or song idea. */
export function canHideContent(args: {
  actorRole: MemberRole;
  actorId: string;
  authorId: string | null;
  authorRole: MemberRole | null;
  shared?: boolean;
}): "ok" | "forbidden" {
  if (args.actorRole === "staff") return "ok";
  if (args.authorId && args.authorId === args.actorId) return "ok";
  if (args.actorRole === "host" && args.shared) return "ok";
  if (args.actorRole === "host" && (args.authorRole === "guest" || args.authorId == null)) return "ok";
  return "forbidden";
}

/** Staff see removed content. Everyone else loses hidden rows and rows whose
    author they blocked. A null author is not blocked. */
export function contentVisible(args: {
  viewerRole: MemberRole;
  authorId: string | null;
  hidden: boolean;
  blockedAuthorIds: ReadonlySet<string>;
}): boolean {
  if (args.viewerRole === "staff") return true;
  if (args.hidden) return false;
  if (args.authorId && args.blockedAuthorIds.has(args.authorId)) return false;
  return true;
}

export function notesForViewer(
  notes: string | null,
  authorId: string | null,
  hidden: boolean,
  viewerRole: MemberRole,
  blockedAuthorIds: ReadonlySet<string>,
): { notes: string | null; hidden?: true } {
  if (!contentVisible({ viewerRole, authorId, hidden, blockedAuthorIds })) {
    return { notes: null };
  }
  if (viewerRole === "staff" && hidden) return { notes, hidden: true };
  return { notes };
}

export type ModerationPerson = {
  userId: string;
  /** Name stored for this person on this event. Null when no name is on file, or when this viewer may not see it. */
  displayName: string | null;
  /** Unique within the returned list. This is what to show. userId stays the value sent back to block, unblock, report, or remove. */
  label: string;
  /** Null when this person is no longer a member of this event. */
  role: MemberRole | null;
};

export type ModerationNameInput = {
  userId: string;
  /** Role on this event. Null when the account is not a member here. */
  role: MemberRole | null;
  /** Client name only when that client is linked to this event. */
  clientFirstName?: string | null;
  clientLastName?: string | null;
  /** Guest name only when that guest row belongs to this event. */
  guestFirstName?: string | null;
  guestLastName?: string | null;
  /** Employee name. Ignored for a guest viewer. */
  staffFirstName?: string | null;
  staffLastName?: string | null;
};

const NAME_EMAIL = /@/;
const NAME_PHONE = /^\+?[\d\s().-]{7,}$/;

function cleanNamePart(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || NAME_EMAIL.test(trimmed) || NAME_PHONE.test(trimmed)) return null;
  return trimmed;
}

/** First and last name only. An email or phone stored in a name field is dropped. */
export function moderationDisplayName(firstName: string | null | undefined, lastName: string | null | undefined): string | null {
  const parts = [cleanNamePart(firstName), cleanNamePart(lastName)].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" ") : null;
}

function nameFallback(role: MemberRole | null): string {
  if (role === "host") return "Host";
  if (role === "staff") return "Xpress";
  return "Guest";
}

/**
  Labels for people the caller is already allowed to act on.
  Names come only from this event. A guest does not receive a staff personal name.
  Someone who is not a member of this event does not contribute a name from any other event.
  Colliding or missing names get a numeric suffix so two blocked people, or two likes, stay selectable.
  The suffix is not a user id. userId remains the id to send to the API.
*/
export function labelsForModeration(viewerRole: MemberRole, people: ModerationNameInput[]): ModerationPerson[] {
  const seenIds = new Set<string>();
  const unique = people.filter((person) => {
    if (!person.userId || seenIds.has(person.userId)) return false;
    seenIds.add(person.userId);
    return true;
  });
  const prepared = unique.map((person) => {
    const exposeName = person.role != null && !(viewerRole === "guest" && person.role === "staff");
    let displayName: string | null = null;
    if (exposeName && person.role === "host") {
      displayName = moderationDisplayName(person.clientFirstName, person.clientLastName);
    } else if (exposeName && person.role === "guest") {
      displayName = moderationDisplayName(person.guestFirstName, person.guestLastName);
    } else if (exposeName && person.role === "staff") {
      displayName = moderationDisplayName(person.staffFirstName, person.staffLastName);
    }
    return { userId: person.userId, role: person.role, displayName, base: displayName ?? nameFallback(person.role) };
  });
  const totals = new Map<string, number>();
  for (const person of prepared) totals.set(person.base, (totals.get(person.base) ?? 0) + 1);
  const used = new Map<string, number>();
  const numberFor = new Map<string, number>();
  for (const person of [...prepared].sort((a, b) => a.userId.localeCompare(b.userId))) {
    const next = (used.get(person.base) ?? 0) + 1;
    used.set(person.base, next);
    numberFor.set(person.userId, next);
  }
  return prepared.map((person) => {
    const total = totals.get(person.base) ?? 1;
    const n = numberFor.get(person.userId) ?? 1;
    return {
      userId: person.userId,
      displayName: person.displayName,
      label: total === 1 ? person.base : `${person.base} ${n}`,
      role: person.role,
    };
  });
}

export function textForViewer(
  text: string | null,
  authorId: string | null,
  hidden: boolean,
  viewerRole: MemberRole,
  blockedAuthorIds: ReadonlySet<string>,
): { text: string | null; hidden?: true } {
  const notes = notesForViewer(text, authorId, hidden, viewerRole, blockedAuthorIds);
  if (notes.hidden) return { text: notes.notes, hidden: true };
  return { text: notes.notes };
}

export type ReportInput = {
  targetType: ContentType;
  targetId: string | null;
  targetUserId: string | null;
  reason: ReportReason;
  details: string | null;
};

export function parseReportBody(
  body: unknown,
): { ok: true; value: ReportInput } | { ok: false; status: 400; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: UGC_ERRORS.missing };
  }
  const rec = body as Record<string, unknown>;
  const targetType = rec.targetType;
  if (typeof targetType !== "string" || !(CONTENT_TYPES as readonly string[]).includes(targetType)) {
    return { ok: false, status: 400, error: UGC_ERRORS.targetType };
  }
  const reason = rec.reason;
  if (typeof reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, status: 400, error: UGC_ERRORS.reason };
  }
  const type = targetType as ContentType;
  const targetId = rec.targetId == null || rec.targetId === "" ? null : rec.targetId;
  const targetUserId = rec.targetUserId == null || rec.targetUserId === "" ? null : rec.targetUserId;
  if (targetId != null && !isUuid(targetId)) return { ok: false, status: 400, error: UGC_ERRORS.targetId };
  if (targetUserId != null && !isUuid(targetUserId)) {
    return { ok: false, status: 400, error: UGC_ERRORS.targetUser };
  }
  if (type === "user") {
    if (!isUuid(targetUserId)) return { ok: false, status: 400, error: UGC_ERRORS.targetUser };
  } else if (type === "song_like") {
    if (!isUuid(targetId)) return { ok: false, status: 400, error: UGC_ERRORS.targetId };
    if (!isUuid(targetUserId)) return { ok: false, status: 400, error: UGC_ERRORS.targetUser };
  } else if (!isUuid(targetId)) {
    return { ok: false, status: 400, error: UGC_ERRORS.targetId };
  }
  let details: string | null = null;
  if (rec.details != null && rec.details !== "") {
    if (typeof rec.details !== "string") return { ok: false, status: 400, error: UGC_ERRORS.details };
    details = rec.details.trim();
    if (details.length > DETAIL_MAX) return { ok: false, status: 400, error: UGC_ERRORS.details };
    if (!details) details = null;
  }
  return {
    ok: true,
    value: {
      targetType: type,
      targetId: type === "user" ? null : (targetId as string),
      targetUserId: isUuid(targetUserId) ? targetUserId : null,
      reason: reason as ReportReason,
      details,
    },
  };
}

export function parseHideBody(
  body: unknown,
): { ok: true; value: { targetType: Exclude<ContentType, "user">; targetId: string; targetUserId: string | null } } | { ok: false; status: 400; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: UGC_ERRORS.missing };
  }
  const rec = body as Record<string, unknown>;
  if (rec.targetType === "user") return { ok: false, status: 400, error: UGC_ERRORS.userNotHide };
  const parsed = parseReportBody({
    targetType: rec.targetType,
    targetId: rec.targetId,
    targetUserId: rec.targetUserId,
    reason: "other",
  });
  if (!parsed.ok) return parsed;
  if (parsed.value.targetType === "user" || !parsed.value.targetId) {
    return { ok: false, status: 400, error: UGC_ERRORS.targetId };
  }
  return {
    ok: true,
    value: {
      targetType: parsed.value.targetType,
      targetId: parsed.value.targetId,
      targetUserId: parsed.value.targetUserId,
    },
  };
}

export function isMissingModerationSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST205") {
    return true;
  }
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("event_content_reports") ||
    msg.includes("event_member_blocks") ||
    msg.includes("hidden_at") ||
    msg.includes("client_notes_hidden") ||
    msg.includes("cover_photo_hidden") ||
    msg.includes("schema cache")
  );
}
