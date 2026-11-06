import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { formatPhone, toE164 } from "./phone.ts";
import {
  INVITE_TTL_MS,
  JOIN_ALPHABET,
  JOIN_ATTEMPT_LIMIT,
  JOIN_CODE_LENGTH,
  JOIN_CODE_TTL_MS,
  canRedeemJoinCode,
  canRemoveCoupleMember,
  canResendInvite,
  clientCellPhone,
  coupleManageDecision,
  decryptJoinCode,
  encryptJoinCode,
  appJoinScheme,
  decryptJoinToken,
  encryptJoinToken,
  evaluateLinkRedeem,
  evaluateRedeem,
  formatJoinCode,
  generateJoinCode,
  generateJoinToken,
  hashJoinCode,
  hashJoinToken,
  htmlHasJoinLink,
  inviteExpiry,
  inviteMessage,
  JOIN_LINK_TTL_MS,
  joinCodeEmailSection,
  joinCodeExpiry,
  joinLinkExpiry,
  joinLinkUrl,
  normalizeJoinCode,
  normalizeJoinToken,
  placeJoinLinkTags,
  parseInviteInput,
  phoneMatchKey,
  pickAppUrl,
  placeAppJoinCode,
  planInviteClaim,
  rateLimitDecision,
  resolveJoinCodeKey,
  samePhone,
  visibleInviteStatus,
  type OpenInvite,
} from "./eventAccess.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(join(root, "supabase/migrations/00212_event_app_access.sql"), "utf8");
const membersRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/members/route.ts"), "utf8");
const inviteRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/invites/route.ts"), "utf8");
const redeemRoute = readFileSync(join(root, "src/app/api/mobile/join-code/redeem/route.ts"), "utf8");
const claimRoute = readFileSync(join(root, "src/app/api/mobile/invites/claim/route.ts"), "utf8");
const joinRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/join-code/route.ts"), "utf8");
const resetRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/join-code/reset/route.ts"), "utf8");
const removeRoute = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/members/[clientId]/route.ts"), "utf8");
const mobileAuth = readFileSync(join(root, "src/lib/mobileCouple.ts"), "utf8");
const accounts = readFileSync(join(root, "src/lib/accounts.ts"), "utf8");

const KEY = "test-join-key";
const NOW = Date.parse("2026-06-01T15:00:00Z");
const HOUR = 60 * 60 * 1000;

function invite(partial: Partial<OpenInvite> & Pick<OpenInvite, "id" | "eventId" | "clientId">): OpenInvite {
  return {
    createdClient: false,
    role: "Partner",
    email: null,
    phoneDigits: null,
    status: "pending",
    expiresAt: NOW + INVITE_TTL_MS,
    invitedAt: NOW,
    ...partial,
  };
}

describe("join codes", () => {
  it("uses a short alphabet with no ambiguous characters and enough entropy", () => {
    assert.equal(JOIN_ALPHABET.length, 31);
    assert.equal(JOIN_CODE_LENGTH, 8);
    for (const ch of ["0", "O", "1", "I", "L"]) assert.equal(JOIN_ALPHABET.includes(ch), false);
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      assert.equal(code.length, JOIN_CODE_LENGTH);
      assert.equal(normalizeJoinCode(code), code);
      for (const ch of code) assert.equal(JOIN_ALPHABET.includes(ch), true);
      codes.add(code);
    }
    assert.ok(codes.size > 190);
  });

  it("normalizes dashes and case, and formats for people", () => {
    assert.equal(normalizeJoinCode(" k7np-m4qx "), "K7NPM4QX");
    assert.equal(formatJoinCode("K7NPM4QX"), "K7NP-M4QX");
    assert.equal(normalizeJoinCode("K7NP-M4Q0"), null);
    assert.equal(normalizeJoinCode("SHORT"), null);
    assert.equal(normalizeJoinCode("K7NPO4QX"), null);
  });

  it("hashes and seals the code so it can be shown again", () => {
    const code = "K7NPM4QX";
    assert.equal(hashJoinCode("k7np-m4qx", KEY), hashJoinCode(code, KEY));
    assert.notEqual(hashJoinCode(code, KEY), hashJoinCode(code, "other"));
    const sealed = encryptJoinCode(code, KEY);
    assert.equal(sealed.includes(code), false);
    assert.equal(decryptJoinCode(sealed, KEY), code);
    assert.equal(decryptJoinCode(sealed, "other"), null);
  });

  it("expires invites in 14 days and codes in 90", () => {
    assert.equal(inviteExpiry(NOW) - NOW, 14 * 24 * HOUR);
    assert.equal(joinCodeExpiry(NOW) - NOW, 90 * 24 * HOUR);
  });

  it("prefers the dedicated key and a real app link", () => {
    assert.equal(resolveJoinCodeKey({ EVENT_JOIN_CODE_KEY: " dedicated ", SUPABASE_SERVICE_ROLE_KEY: "fallback" }), "dedicated");
    assert.equal(resolveJoinCodeKey({ SUPABASE_SERVICE_ROLE_KEY: "fallback" }), "fallback");
    assert.throws(() => resolveJoinCodeKey({}), /EVENT_JOIN_CODE_KEY/);
    assert.equal(pickAppUrl(" https://testflight.apple.com/join/abc ", { ios: "https://apps.apple.com/app/id1" }), "https://testflight.apple.com/join/abc");
    assert.equal(pickAppUrl("javascript:alert(1)", { ios: "https://apps.apple.com/app/id1" }), "https://apps.apple.com/app/id1");
    assert.equal(pickAppUrl("", { web: "https://xos.xpressdjs.com/portal" }), "https://xos.xpressdjs.com/portal");
  });
});

describe("auth checks", () => {
  it("lets only a linked couple member manage access", () => {
    assert.equal(coupleManageDecision("host"), "ok");
    assert.equal(coupleManageDecision("guest"), "forbidden");
    assert.equal(coupleManageDecision("staff"), "forbidden");
    assert.equal(coupleManageDecision(null), "forbidden");
  });

  it("lets a new login or a client redeem, and blocks staff and guests", () => {
    assert.equal(canRedeemJoinCode(null), true);
    assert.equal(canRedeemJoinCode("client"), true);
    assert.equal(canRedeemJoinCode("staff"), false);
    assert.equal(canRedeemJoinCode("event_guest"), false);
  });

  it("will not remove the contract holder", () => {
    assert.equal(canRemoveCoupleMember({ onEvent: true, isContractHolder: false, isPrimary: false, isAnchor: false }), "ok");
    assert.equal(canRemoveCoupleMember({ onEvent: true, isContractHolder: true, isPrimary: false, isAnchor: false }), "protected");
    assert.equal(canRemoveCoupleMember({ onEvent: true, isContractHolder: false, isPrimary: true, isAnchor: false }), "protected");
    assert.equal(canRemoveCoupleMember({ onEvent: true, isContractHolder: false, isPrimary: false, isAnchor: true }), "protected");
    assert.equal(canRemoveCoupleMember({ onEvent: false, isContractHolder: false, isPrimary: false, isAnchor: false }), "missing");
  });

  it("does not treat a missing account as staff in the mobile guard", () => {
    assert.match(mobileAuth, /coupleManageDecision/);
    assert.equal(mobileAuth.includes('?? "staff"'), false);
    for (const src of [membersRoute, inviteRoute, joinRoute, resetRoute, removeRoute]) {
      assert.match(src, /requireCoupleHost/);
    }
    assert.match(redeemRoute, /requireMobileUser/);
    assert.match(claimRoute, /claimInvitesForUser/);
  });
});

describe("rate limit and redemption", () => {
  const match = { eventId: "evt-1", expiresAt: NOW + JOIN_CODE_TTL_MS };

  it("blocks the 8th failed try inside the hour and opens again after the window", () => {
    const failures = Array.from({ length: 7 }, (_, i) => NOW - (7 - i) * 60_000);
    assert.equal(rateLimitDecision(failures, NOW, JOIN_ATTEMPT_LIMIT, HOUR).blocked, false);
    const blocked = rateLimitDecision([...failures, NOW - 1_000], NOW, JOIN_ATTEMPT_LIMIT, HOUR);
    assert.equal(blocked.blocked, true);
    assert.ok(blocked.retryAfterSec > 0);
    assert.equal(rateLimitDecision(failures.map((t) => t - HOUR), NOW, JOIN_ATTEMPT_LIMIT, HOUR).blocked, false);
  });

  it("redeems a live code for a client and refuses the wrong, expired, and over-limit cases", () => {
    const ok = evaluateRedeem({
      accountType: "client",
      rawCode: "K7NP-M4QX",
      now: NOW,
      userFailures: [],
      ipFailures: [],
      match,
      alreadyOnEvent: false,
    });
    assert.deepEqual(ok, { ok: true, eventId: "evt-1", alreadyMember: false, countFailure: false });

    const already = evaluateRedeem({
      accountType: null,
      rawCode: "K7NPM4QX",
      now: NOW,
      userFailures: [],
      ipFailures: [],
      match,
      alreadyOnEvent: true,
    });
    assert.equal(already.ok && already.alreadyMember, true);

    const wrong = evaluateRedeem({
      accountType: "client",
      rawCode: "K7NP-M4QX",
      now: NOW,
      userFailures: [],
      ipFailures: [],
      match: null,
      alreadyOnEvent: false,
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) {
      assert.equal(wrong.status, 404);
      assert.equal(wrong.countFailure, true);
    }

    const expired = evaluateRedeem({
      accountType: "client",
      rawCode: "K7NP-M4QX",
      now: NOW,
      userFailures: [],
      ipFailures: [],
      match: { eventId: "evt-1", expiresAt: NOW - 1 },
      alreadyOnEvent: false,
    });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.status, 404);

    const messy = evaluateRedeem({
      accountType: "client",
      rawCode: "nope",
      now: NOW,
      userFailures: [],
      ipFailures: [],
      match,
      alreadyOnEvent: false,
    });
    assert.equal(messy.ok, false);
    if (!messy.ok) assert.equal(messy.status, 400);

    const guest = evaluateRedeem({
      accountType: "event_guest",
      rawCode: "K7NP-M4QX",
      now: NOW,
      userFailures: [],
      ipFailures: [],
      match,
      alreadyOnEvent: false,
    });
    assert.equal(guest.ok, false);
    if (!guest.ok) {
      assert.equal(guest.status, 403);
      assert.equal(guest.countFailure, false);
    }

    const staff = evaluateRedeem({
      accountType: "staff",
      rawCode: "K7NP-M4QX",
      now: NOW,
      userFailures: [],
      ipFailures: [],
      match,
      alreadyOnEvent: false,
    });
    assert.equal(staff.ok, false);
    if (!staff.ok) assert.equal(staff.status, 403);

    const limited = evaluateRedeem({
      accountType: "client",
      rawCode: "K7NP-M4QX",
      now: NOW,
      userFailures: Array.from({ length: JOIN_ATTEMPT_LIMIT }, () => NOW - 1_000),
      ipFailures: [],
      match,
      alreadyOnEvent: false,
    });
    assert.equal(limited.ok, false);
    if (!limited.ok) {
      assert.equal(limited.status, 429);
      assert.equal(limited.countFailure, false);
    }
  });
});

describe("invite claim", () => {
  it("matches phone or email and ignores expired or revoked invites", () => {
    assert.equal(phoneMatchKey("+1 (305) 555-0199"), "3055550199");
    assert.equal(samePhone("13055550199", "305-555-0199"), true);

    const plan = planInviteClaim({
      accountType: null,
      clientId: null,
      email: "Jordan@Example.com",
      phoneDigits: "13055550199",
      now: NOW,
      invites: [
        invite({ id: "old", eventId: "evt-a", clientId: "client-a", email: "other@example.com", expiresAt: NOW - 1 }),
        invite({ id: "revoked", eventId: "evt-b", clientId: "client-b", phoneDigits: "3055550199", status: "revoked" }),
        invite({ id: "phone", eventId: "evt-c", clientId: "client-c", phoneDigits: "3055550199", createdClient: true, role: "Parent", invitedAt: NOW }),
        invite({ id: "mail", eventId: "evt-d", clientId: "client-d", email: "jordan@example.com", createdClient: true, invitedAt: NOW + 1 }),
      ],
    });
    assert.equal(plan.reason, "linked");
    assert.deepEqual(
      plan.actions.map((action) => action.inviteId),
      ["phone", "mail"],
    );
    assert.equal(plan.actions[0]?.createAccount, true);
    assert.equal(plan.actions[0]?.useClientId, "client-c");
    assert.equal(plan.actions[1]?.createAccount, false);
    assert.equal(plan.actions[1]?.useClientId, "client-c");
    assert.equal(plan.actions[1]?.dropPlaceholderClientId, "client-d");
  });

  it("keeps staff and guest logins as they are", () => {
    const invites = [invite({ id: "phone", eventId: "evt-c", clientId: "client-c", phoneDigits: "3055550199" })];
    assert.equal(planInviteClaim({ accountType: "staff", clientId: null, email: null, phoneDigits: "3055550199", invites, now: NOW }).reason, "staff");
    assert.equal(
      planInviteClaim({ accountType: "event_guest", clientId: null, email: null, phoneDigits: "3055550199", invites, now: NOW }).reason,
      "guest",
    );
    const existing = planInviteClaim({
      accountType: "client",
      clientId: "real",
      email: null,
      phoneDigits: "3055550199",
      invites: [invite({ id: "phone", eventId: "evt-c", clientId: "placeholder", phoneDigits: "3055550199", createdClient: true })],
      now: NOW,
    });
    assert.equal(existing.actions[0]?.useClientId, "real");
    assert.equal(existing.actions[0]?.dropPlaceholderClientId, "placeholder");
    assert.equal(existing.actions[0]?.createAccount, false);
  });

  it("parses an invite and writes English and Spanish without an em dash", () => {
    const parsed = parseInviteInput({ phone: "305-555-0199", name: "Jordan Lee", role: "  Parent " });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.phoneE164, toE164("305-555-0199"));
      assert.equal(parsed.phoneE164, "+13055550199");
      assert.equal(clientCellPhone(parsed.phoneE164), formatPhone(parsed.phoneE164));
      assert.equal(parsed.firstName, "Jordan");
      assert.equal(parsed.lastName, "Lee");
      assert.equal(parsed.role, "Parent");
      assert.equal(parsed.lang, "both");
    }
    assert.equal(parseInviteInput({}).ok, false);
    assert.equal(parseInviteInput({ phone: "555" }).ok, false);

    const both = inviteMessage({
      inviter: "Alex",
      eventName: "Alex & Jordan",
      url: "https://testflight.apple.com/join/abc",
      channel: "sms",
      lang: "both",
    });
    assert.match(both.sms, /Alex invited you/);
    assert.match(both.sms, /te invitó/);
    assert.match(both.html, /same access as the couple/);
    assert.match(both.html, /mismo acceso/);
    assert.equal(both.sms.includes("\u2014"), false);
    assert.equal(both.html.includes("\u2014"), false);

    const es = inviteMessage({
      inviter: "Alex",
      eventName: "la boda",
      url: null,
      channel: "email",
      lang: "es",
    });
    assert.match(es.subject, /app de Xpress/);
    assert.match(es.sms, /App Store/);
    assert.equal(es.sms.includes("Alex invited you"), false);

    const section = joinCodeEmailSection({
      code: "K7NPM4QX",
      eventName: "Alex & Jordan",
      expiresAt: NOW + JOIN_CODE_TTL_MS,
      timeZone: "America/New_York",
      url: "https://apps.apple.com/app/id1",
    });
    assert.match(section.html, /K7NP-M4QX/);
    assert.match(section.html, /El código de tu evento/);
    assert.equal(section.html.includes("\u2014"), false);
    const hidden = joinCodeEmailSection({
      code: "K7NPM4QX",
      eventName: "Alex & Jordan",
      expiresAt: NOW + JOIN_CODE_TTL_MS,
      timeZone: "America/New_York",
      url: null,
      redact: true,
    });
    assert.equal(hidden.html.includes("K7NP-M4QX"), false);
  });

  it("places the join code in the client invite once", () => {
    assert.equal(placeAppJoinCode("<p>Hi</p>", "<section>CODE</section>"), "<p>Hi</p><section>CODE</section>");
    assert.equal(placeAppJoinCode("<p><app_join_code></p>", "CODE"), "<p>CODE</p>");
    assert.equal(placeAppJoinCode("<p>&lt;app_join_code&gt;</p>", "CODE"), "<p>CODE</p>");
    assert.match(accounts, /appJoinCodeEmailParts/);
    assert.match(accounts, /placeAppJoinCode/);
    assert.equal(canResendInvite("pending", NOW + 1000, NOW), true);
    assert.equal(canResendInvite("pending", NOW - 1000, NOW), true);
    assert.equal(visibleInviteStatus("pending", NOW - 1000, NOW), "expired");
    assert.equal(canResendInvite("revoked", NOW + 1000, NOW), false);
  });
});

describe("migration", () => {
  it("stores a hash, locks the code table, and claims invites on sign-in", () => {
    assert.match(migration, /code_hash/);
    assert.match(migration, /code_ciphertext/);
    assert.equal(/\bcode text\b/.test(migration), false);
    assert.match(migration, /enable row level security/);
    assert.match(migration, /revoke all on table public.event_join_codes from public, anon, authenticated/);
    assert.match(migration, /revoke all on table public.event_join_attempts from public, anon, authenticated/);
    assert.match(migration, /xos_is_event_host/);
    assert.match(migration, /v_type in \('staff', 'event_guest'\)/);
    assert.match(migration, /after insert on auth.sessions/);
    assert.match(migration, /after insert or update of email, phone on auth.users/);
    assert.match(migration, /app_join_code/);
    assert.match(migration, /status = 'pending'/);
    assert.match(migration, /expires_at > now\(\)/);
  });
});

describe("join links", () => {
  const linkMigration = readFileSync(join(root, "supabase/migrations/00213_event_join_links.sql"), "utf8");
  const linkRedeem = readFileSync(join(root, "src/app/api/mobile/join-link/redeem/route.ts"), "utf8");
  const mailer = readFileSync(join(root, "src/lib/mailgun.ts"), "utf8");

  it("seals a path token and builds a path URL", () => {
    const token = generateJoinToken();
    assert.equal(token.length, 22);
    assert.equal(normalizeJoinToken(token), token);
    assert.equal(normalizeJoinToken(`${token}?x=1`), null);
    assert.equal(normalizeJoinToken("short"), null);
    assert.equal(hashJoinToken(token, KEY), hashJoinToken(token, KEY));
    assert.notEqual(hashJoinToken(token, KEY), hashJoinToken(token, "other"));
    const sealed = encryptJoinToken(token, KEY);
    assert.equal(sealed.includes(token), false);
    assert.equal(decryptJoinToken(sealed, KEY), token);
    assert.equal(decryptJoinToken(sealed, "other"), null);
    assert.equal(joinLinkUrl("https://xos.xpressdjs.com/", token), `https://xos.xpressdjs.com/j/${token}`);
    assert.equal(appJoinScheme(token), `xpressclient://j/${token}`);
    assert.equal(joinLinkExpiry(NOW), NOW + JOIN_LINK_TTL_MS);
    assert.equal(htmlHasJoinLink(`<a href="https://xos.xpressdjs.com/j/${token}">open</a>`), true);
    assert.equal(htmlHasJoinLink("<p>Hello</p>"), false);
  });

  it("redeems a link like a code and does not downgrade a host", () => {
    const base = {
      accountType: "client" as const,
      rawToken: generateJoinToken(),
      now: NOW,
      userFailures: [] as number[],
      ipFailures: [] as number[],
      match: { eventId: "evt", role: "guest" as const, expiresAt: NOW + 1000 },
      existingRole: null,
    };
    const joined = evaluateLinkRedeem(base);
    assert.equal(joined.ok && joined.role, "guest");
    assert.equal(joined.ok && joined.alreadyMember, false);

    const stay = evaluateLinkRedeem({ ...base, existingRole: "host", match: { ...base.match, role: "guest" } });
    assert.equal(stay.ok && stay.role, "host");
    assert.equal(stay.ok && stay.alreadyMember, true);

    const upgrade = evaluateLinkRedeem({ ...base, existingRole: "guest", match: { ...base.match, role: "host" } });
    assert.equal(upgrade.ok && upgrade.upgrade, true);
    assert.equal(upgrade.ok && upgrade.role, "host");

    const again = evaluateLinkRedeem({ ...base, existingRole: "guest" });
    assert.equal(again.ok && again.alreadyMember, true);

    const staff = evaluateLinkRedeem({ ...base, accountType: "staff" });
    assert.equal(staff.ok, false);
    if (!staff.ok) assert.equal(staff.countFailure, false);

    const bad = evaluateLinkRedeem({ ...base, rawToken: "nope" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.countFailure, true);

    const expired = evaluateLinkRedeem({ ...base, match: { ...base.match, expiresAt: NOW - 1 } });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.status, 404);

    const limited = evaluateLinkRedeem({ ...base, userFailures: Array.from({ length: JOIN_ATTEMPT_LIMIT }, () => NOW - 1000) });
    assert.equal(limited.ok, false);
    if (!limited.ok) assert.equal(limited.status, 429);
  });

  it("puts raw link tags in the body and drops the one-time code wording", () => {
    const token = generateJoinToken();
    const url = joinLinkUrl("https://xos.xpressdjs.com", token);
    assert.equal(placeJoinLinkTags("<a href=\"<app_host_link>\">Go</a>", { host: url, guest: null }), `<a href="${url}">Go</a>`);
    assert.equal(placeJoinLinkTags("<p>&lt;app_guest_link&gt;</p>", { guest: url }), `<p>${url}</p>`);
    const mail = inviteMessage({
      inviter: "Alex",
      eventName: "Alex & Jordan",
      url: "https://apps.apple.com/app/id1",
      joinUrl: url,
      channel: "email",
      lang: "en",
    });
    assert.match(mail.html, new RegExp(token));
    assert.equal(mail.html.includes("one-time"), false);
    assert.equal(mail.sms.includes("one-time"), false);
    assert.equal(mail.html.includes("\u2014"), false);
    assert.match(linkRedeem, /redeemJoinLink/);
    assert.match(mailer, /o:tracking-clicks/);
  });

  it("stores link hashes, keeps guest money closed, and serves both links", () => {
    assert.match(linkMigration, /token_hash/);
    assert.match(linkMigration, /token_ciphertext/);
    assert.equal(/\btoken text\b/.test(linkMigration), false);
    assert.match(linkMigration, /revoke all on table public.event_join_links from public, anon, authenticated/);
    assert.match(linkMigration, /event_app_members/);
    assert.match(linkMigration, /role = 'host'/);
    assert.match(linkMigration, /guest_enabled/);
    assert.match(linkMigration, /xos_is_host\(event_id\)/);
    assert.match(linkMigration, /event_guest_card/);
    assert.match(linkMigration, /app_host_link/);
    assert.match(linkMigration, /app_guest_link/);
    assert.match(linkMigration, /event-files read scoped/);
    assert.match(linkMigration, /xos_is_host\(\(\(storage.foldername\(name\)\)\[1\]\)::uuid\)/);
    const scheme = readFileSync(join(root, "src/lib/clientApp.ts"), "utf8");
    assert.match(scheme, /xpressclient/);
    assert.match(scheme, /com\.xpressentertainment\.client/);
  });
});
