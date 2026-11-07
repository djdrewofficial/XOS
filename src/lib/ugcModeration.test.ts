import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONTENT_TYPES,
  UGC_ERRORS,
  accessAfterGuestRemoval,
  canHideContent,
  canRemoveGuest,
  contentVisible,
  hasEventAccess,
  hideDeniedMessage,
  labelsForModeration,
  memberRoleFromFacts,
  moderationDisplayName,
  notesForViewer,
  parseHideBody,
  parseReportBody,
} from "./ugcModeration.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(join(root, "supabase/migrations/00216_event_ugc_moderation.sql"), "utf8");
const removedCommunity = readFileSync(join(root, "supabase/migrations/00147_remove_community.sql"), "utf8");
const members = readFileSync(join(root, "supabase/migrations/00213_event_join_links.sql"), "utf8");
const actions = readFileSync(join(root, "src/app/portal/plan/[eventId]/actions.ts"), "utf8");
const notesRoute = readFileSync(join(root, "src/app/api/mobile/planning/sections/[id]/notes/route.ts"), "utf8");
const contentRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/content/route.ts"), "utf8");
const hideRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/content/hide/route.ts"), "utf8");
const reportRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/reports/route.ts"), "utf8");
const blockRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/blocks/route.ts"), "utf8");
const guestRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/guests/[userId]/route.ts"), "utf8");
const server = readFileSync(join(root, "src/lib/ugcModerationServer.ts"), "utf8");

const guestId = "11111111-1111-4111-8111-111111111111";
const hostId = "22222222-2222-4222-8222-222222222222";
const otherHost = "33333333-3333-4333-8333-333333333333";
const songId = "44444444-4444-4444-8444-444444444444";

describe("content another member can see", () => {
  it("covers songs, likes, answers, notes, and the other shared fields", () => {
    assert.deepEqual(CONTENT_TYPES, [
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
    ]);
  });

  it("does not treat community posts as live content", () => {
    assert.match(removedCommunity, /drop table if exists public\.community_posts/);
    assert.equal(CONTENT_TYPES.includes("user"), true);
    assert.doesNotMatch(migration, /community_posts/);
  });
});

describe("hide permissions", () => {
  it("lets a guest hide only their own content", () => {
    assert.equal(
      canHideContent({ actorRole: "guest", actorId: guestId, authorId: guestId, authorRole: "guest" }),
      "ok",
    );
    assert.equal(
      canHideContent({ actorRole: "guest", actorId: guestId, authorId: hostId, authorRole: "host" }),
      "forbidden",
    );
    assert.equal(hideDeniedMessage("guest"), UGC_ERRORS.ownContent);
  });

  it("lets a host hide a guest's content and not another host's song", () => {
    assert.equal(
      canHideContent({ actorRole: "host", actorId: hostId, authorId: guestId, authorRole: "guest" }),
      "ok",
    );
    assert.equal(
      canHideContent({ actorRole: "host", actorId: hostId, authorId: otherHost, authorRole: "host" }),
      "forbidden",
    );
    assert.equal(
      canHideContent({ actorRole: "host", actorId: hostId, authorId: hostId, authorRole: "host" }),
      "ok",
    );
    assert.equal(hideDeniedMessage("host"), UGC_ERRORS.guestContent);
  });

  it("lets either host hide a shared couple field", () => {
    assert.equal(
      canHideContent({
        actorRole: "host",
        actorId: hostId,
        authorId: otherHost,
        authorRole: "host",
        shared: true,
      }),
      "ok",
    );
    assert.equal(
      canHideContent({
        actorRole: "guest",
        actorId: guestId,
        authorId: hostId,
        authorRole: "host",
        shared: true,
      }),
      "forbidden",
    );
  });

  it("lets staff hide anything", () => {
    assert.equal(
      canHideContent({ actorRole: "staff", actorId: hostId, authorId: otherHost, authorRole: "host" }),
      "ok",
    );
  });
});

describe("guest removal", () => {
  const onlyGuest = { staff: false, clientOnEvent: false, appRole: "guest" as const, legacyGuest: false };

  it("lets a host remove a guest membership and that guest then has no access", () => {
    assert.equal(canRemoveGuest("host", onlyGuest), "ok");
    assert.equal(hasEventAccess(onlyGuest), true);
    assert.equal(hasEventAccess(accessAfterGuestRemoval(onlyGuest)), false);
    assert.match(members, /event_app_members m/);
    assert.match(members, /m\.role = 'guest'/);
    assert.match(server, /event_app_members/);
    assert.match(server, /\.eq\("role", "guest"\)/);
  });

  it("refuses a guest, a host target, and a guest who is also a client on the event", () => {
    assert.equal(canRemoveGuest("guest", onlyGuest), "forbidden");
    assert.equal(
      canRemoveGuest("host", { staff: false, clientOnEvent: false, appRole: "host", legacyGuest: false }),
      "forbidden",
    );
    assert.equal(
      canRemoveGuest("host", { staff: false, clientOnEvent: true, appRole: "guest", legacyGuest: false }),
      "forbidden",
    );
    assert.equal(
      canRemoveGuest("host", { staff: false, clientOnEvent: false, appRole: null, legacyGuest: true }),
      "not_found",
    );
    assert.equal(hasEventAccess(accessAfterGuestRemoval({ ...onlyGuest, legacyGuest: true })), true);
  });

  it("counts a join-link guest from the membership row", () => {
    assert.equal(
      memberRoleFromFacts({ accountType: null, clientOnEvent: false, appRole: "guest", legacyGuest: false }),
      "guest",
    );
    assert.equal(
      memberRoleFromFacts({ accountType: "client", clientOnEvent: true, appRole: "guest", legacyGuest: false }),
      "host",
    );
  });
});

describe("blocked content", () => {
  it("hides the blocked author's rows from that member and keeps them for staff", () => {
    const blocked = new Set([guestId]);
    assert.equal(
      contentVisible({ viewerRole: "host", authorId: guestId, hidden: false, blockedAuthorIds: blocked }),
      false,
    );
    assert.equal(
      contentVisible({ viewerRole: "host", authorId: hostId, hidden: false, blockedAuthorIds: blocked }),
      true,
    );
    assert.equal(
      contentVisible({ viewerRole: "guest", authorId: guestId, hidden: true, blockedAuthorIds: new Set() }),
      false,
    );
    assert.equal(
      contentVisible({ viewerRole: "staff", authorId: guestId, hidden: true, blockedAuthorIds: blocked }),
      true,
    );
    assert.deepEqual(notesForViewer("hello", guestId, false, "host", blocked), { notes: null });
    assert.deepEqual(notesForViewer("hello", guestId, true, "staff", blocked), { notes: "hello", hidden: true });
  });
});

describe("moderation display labels", () => {
  const alexA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const alexB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const removed = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const staffId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  it("keeps two blocked people and two likes selectable without using an id or an email", () => {
    assert.equal(moderationDisplayName("alex@example.com", "Rivera"), "Rivera");
    assert.equal(moderationDisplayName("305-555-1212", " "), null);
    const blocked = labelsForModeration("host", [
      { userId: alexB, role: "guest", guestFirstName: "Alex", guestLastName: "Rivera" },
      { userId: alexA, role: "guest", guestFirstName: "Alex", guestLastName: "Rivera" },
      {
        userId: removed,
        role: null,
        clientFirstName: "Other",
        clientLastName: "Wedding",
        guestFirstName: "Also",
        guestLastName: "Hidden",
      },
    ]);
    assert.deepEqual(
      blocked.map((person) => person.label),
      ["Alex Rivera 2", "Alex Rivera 1", "Guest"],
    );
    assert.equal(blocked[2].displayName, null);
    assert.equal(blocked[2].role, null);
    assert.equal(blocked.every((person) => !person.label.includes("@") && person.label !== person.userId), true);

    const likes = labelsForModeration("guest", [
      { userId: alexA, role: "guest", guestFirstName: "Sam", guestLastName: "Patel" },
      { userId: alexB, role: "host", clientFirstName: "Jordan", clientLastName: "Lee" },
    ]);
    assert.deepEqual(
      likes.map((person) => ({ userId: person.userId, label: person.label })),
      [
        { userId: alexA, label: "Sam Patel" },
        { userId: alexB, label: "Jordan Lee" },
      ],
    );
  });

  it("does not give a guest a staff personal name or a name from outside this event", () => {
    const hidden = labelsForModeration("guest", [
      {
        userId: staffId,
        role: "staff",
        staffFirstName: "Drew",
        staffLastName: "Private",
        clientFirstName: "Drew",
        clientLastName: "Private",
      },
    ]);
    assert.equal(hidden[0].displayName, null);
    assert.equal(hidden[0].label, "Xpress");
    assert.equal(hidden[0].label.includes("Drew"), false);

    const hostView = labelsForModeration("host", [
      { userId: staffId, role: "staff", staffFirstName: "Drew", staffLastName: "Lee" },
    ]);
    assert.equal(hostView[0].displayName, "Drew Lee");

    const offEvent = labelsForModeration("host", [
      {
        userId: removed,
        role: null,
        clientFirstName: "Jordan",
        clientLastName: "Lee",
        guestFirstName: "Pat",
        guestLastName: "Guest",
      },
    ]);
    assert.equal(offEvent[0].displayName, null);
    assert.equal(offEvent[0].label, "Guest");

    const guestNotHost = labelsForModeration("host", [
      {
        userId: alexA,
        role: "guest",
        clientFirstName: "Secret",
        clientLastName: "Host",
        guestFirstName: "Pat",
        guestLastName: "Lee",
      },
    ]);
    assert.equal(guestNotHost[0].displayName, "Pat Lee");
  });

  it("numbers only the people who would otherwise look the same, including removed members", () => {
    const people = labelsForModeration("host", [
      { userId: removed, role: null },
      { userId: alexA, role: "guest" },
      { userId: alexB, role: "host", clientFirstName: "Jordan", clientLastName: "Lee" },
    ]);
    const byId = new Map(people.map((person) => [person.userId, person.label]));
    assert.equal(byId.get(alexB), "Jordan Lee");
    assert.notEqual(byId.get(removed), byId.get(alexA));
    assert.match(byId.get(removed) ?? "", /^Guest \d$/);
    assert.match(byId.get(alexA) ?? "", /^Guest \d$/);
  });
});

describe("report body", () => {
  it("accepts a reason and optional details", () => {
    assert.deepEqual(
      parseReportBody({ targetType: "song", targetId: songId, reason: "spam", details: "  repeated  " }),
      {
        ok: true,
        value: { targetType: "song", targetId: songId, targetUserId: null, reason: "spam", details: "repeated" },
      },
    );
  });

  it("requires the liker on a like and rejects a bad reason", () => {
    const like = parseReportBody({ targetType: "song_like", targetId: songId, reason: "harassment" });
    assert.equal(like.ok, false);
    if (!like.ok) assert.equal(like.error, UGC_ERRORS.targetUser);
    const reason = parseReportBody({ targetType: "song", targetId: songId, reason: "mean" });
    assert.equal(reason.ok, false);
    if (!reason.ok) assert.equal(reason.error, UGC_ERRORS.reason);
  });

  it("does not hide a person through the content hide body", () => {
    const hidden = parseHideBody({ targetType: "user", targetUserId: guestId });
    assert.equal(hidden.ok, false);
    if (!hidden.ok) assert.equal(hidden.error, UGC_ERRORS.userNotHide);
  });
});

describe("database rules", () => {
  it("lets the reporter insert and read their own report, and staff read and resolve", () => {
    assert.match(migration, /create policy "reporter inserts own report"/);
    assert.match(migration, /reporter_id = auth\.uid\(\)/);
    assert.match(migration, /create policy "reporter reads own reports"/);
    assert.match(migration, /reporter_id = auth\.uid\(\) or public\.xos_is_staff\(\)/);
    assert.match(migration, /create policy "staff resolve reports"/);
    assert.match(migration, /using \(public\.xos_is_staff\(\)\)/);
    assert.match(migration, /enable row level security/);
    assert.match(migration, /revoke all on table public\.event_content_reports from public, anon/);
    assert.match(migration, /Report identity cannot be changed/);
    assert.match(migration, /Report reporter must be the signed-in member/);
    assert.match(migration, /Block must be filed by the signed-in member/);
    assert.match(migration, /pg_trigger_depth\(\) > 1/);
    assert.match(migration, /Block can only be removed by the member who created it/);
    assert.match(migration, /target_type = 'user'/);
    assert.match(migration, /new\.created_at := now\(\)/);
  });

  it("hides removed and blocked rows from non-staff", () => {
    assert.match(migration, /create policy "ugc hide songs"/);
    assert.match(migration, /as restrictive for select/);
    assert.match(migration, /public\.xos_ugc_row_visible\(event_id, requested_by, hidden_at\)/);
    assert.match(migration, /event_member_blocks b/);
    assert.match(migration, /b\.blocker_id = auth\.uid\(\)/);
    assert.match(migration, /p_hidden_at is null/);
    assert.match(migration, /public\.xos_is_staff\(\)/);
  });

  it("stops a non-staff hard delete and checks hide rights in the trigger", () => {
    assert.match(migration, /Remove content by hiding it so the DJ can still see it/);
    assert.match(migration, /public\.xos_can_hide_ugc\(event_id, author_id, shared\)/);
    assert.match(migration, /You can only remove your own content/);
    assert.match(migration, /Only staff can restore removed content/);
    assert.match(members, /grant select on table public\.event_app_members to authenticated/);
    assert.doesNotMatch(members, /grant delete on table public\.event_app_members/);
    assert.doesNotMatch(migration, /grant delete on table public\.event_app_members/);
  });

  it("notifies staff through the existing bell catalog", () => {
    assert.match(migration, /'content_report'/);
    assert.match(migration, /A member reported content on <event_name>\./);
    assert.doesNotMatch(migration, /—/);
  });
});

describe("mobile routes", () => {
  it("exposes report, block, hide, content, and guest removal", () => {
    assert.match(reportRoute, /export async function POST/);
    assert.match(reportRoute, /export async function GET/);
    assert.match(blockRoute, /export async function POST/);
    assert.match(hideRoute, /hideContent/);
    assert.match(contentRoute, /listEventContent/);
    assert.match(contentRoute, /people:/);
    assert.match(contentRoute, /likes\.displayName/);
    assert.match(blockRoute, /blockedUserIds/);
    assert.match(blockRoute, /displayName, label, role/);
    assert.match(server, /labelsForModeration/);
    assert.match(server, /select\("id, first_name, last_name"\)/);
    assert.match(server, /viewerRole === "guest"/);
    assert.match(server, /\.eq\("event_id", eventId\)/);
    assert.doesNotMatch(server, /cell_phone|user_metadata|\.select\("[^"]*email/);
    assert.match(guestRoute, /export async function DELETE/);
    assert.match(notesRoute, /notesForViewer/);
    assert.match(actions, /hidden_at: new Date\(\)\.toISOString\(\)/);
    assert.match(actions, /hidden_by: me\.userId/);
  });
});
