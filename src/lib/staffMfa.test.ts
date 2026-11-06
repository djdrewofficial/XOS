import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EMAIL_MFA_LOG_HTML,
  EMAIL_MFA_SUBJECT,
  emailMfaBeginMessage,
  emailMfaConsumeMessage,
  emailMfaContentHtml,
  generateEmailMfaCode,
  hashEmailMfaCode,
  isMissingEmailMfaSchema,
  scrubEmailMfaSecret,
} from "./emailMfa.ts";
import { decideMfaGate } from "./mfaGate.ts";
import { friendlySupabaseMfaError, maskEmail, maskPhone, pickMfaMethod, preferredMfaPhone } from "./mfaMethods.ts";
import { toE164 } from "./phone.ts";
import { readMfaEmailStepUp, sessionIdFromAccessToken, signMfaEmailStepUp } from "./mfaStepUpCookie.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const secret = "xos-email-mfa-test-pepper";
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const otherSession = "33333333-3333-4333-8333-333333333333";

function header(session = sessionId) {
  const body = Buffer.from(JSON.stringify({ session_id: session })).toString("base64url");
  return `aaa.${body}.sig`;
}

describe("email code material", () => {
  it("pads a 6-digit code and refuses a bad generator", () => {
    assert.equal(generateEmailMfaCode(() => 42), "000042");
    assert.throws(() => generateEmailMfaCode(() => 1_000_000));
    assert.throws(() => generateEmailMfaCode(() => -1));
  });

  it("hashes with the pepper and never accepts a short code", () => {
    const first = hashEmailMfaCode("123456", secret);
    assert.equal(first, hashEmailMfaCode("123456", secret));
    assert.notEqual(first, hashEmailMfaCode("123456", `${secret}-other`));
    assert.equal(first.length, 64);
    assert.throws(() => hashEmailMfaCode("12345", secret));
    assert.throws(() => hashEmailMfaCode("123456", "short"));
  });

  it("puts the code in the email and keeps it out of the log and the subject", () => {
    const html = emailMfaContentHtml("654321");
    assert.match(html, /654321/);
    assert.equal(EMAIL_MFA_LOG_HTML.includes("654321"), false);
    assert.equal(EMAIL_MFA_SUBJECT.includes("654321"), false);
    assert.equal(scrubEmailMfaSecret(`provider said 654321 failed`, "654321").includes("654321"), false);
    assert.throws(() => emailMfaContentHtml("nope"));
  });

  it("maps rate limits and wrong codes to plain sentences", () => {
    assert.match(emailMfaBeginMessage("resend"), /minute/);
    assert.match(emailMfaBeginMessage("limited"), /hour/);
    assert.match(emailMfaConsumeMessage("locked"), /new code/);
    assert.match(emailMfaConsumeMessage("expired"), /expired/);
    assert.equal(isMissingEmailMfaSchema("Could not find the table public.staff_email_mfa in the schema cache"), true);
    assert.equal(isMissingEmailMfaSchema("HighLevel not configured"), false);
  });
});

describe("which factor to offer", () => {
  it("prefers the login phone, then the staff profile", () => {
    assert.deepEqual(preferredMfaPhone("305-555-0199", "305-555-0100", toE164), { e164: "+13055550199", source: "login" });
    assert.deepEqual(preferredMfaPhone("", "3055550100", toE164), { e164: "+13055550100", source: "profile" });
    assert.equal(preferredMfaPhone("555", "", toE164), null);
  });

  it("masks destinations and picks authenticator before text before email", () => {
    assert.equal(maskPhone("+13055550199"), "••• ••• 0199");
    assert.equal(maskEmail("Drew@XpressDJs.com"), "d•••@xpressdjs.com");
    assert.equal(pickMfaMethod({ totp: true, phone: true, email: true }), "totp");
    assert.equal(pickMfaMethod({ totp: false, phone: true, email: true }), "phone");
    assert.equal(pickMfaMethod({ totp: false, phone: false, email: true }), "email");
    assert.equal(pickMfaMethod({ totp: false, phone: false, email: false }), null);
  });

  it("explains a disabled phone factor without hiding other errors", () => {
    assert.match(friendlySupabaseMfaError("MFA enroll is disabled for Phone"), /Phone factor/);
    assert.equal(friendlySupabaseMfaError("Invalid TOTP code"), "Invalid TOTP code");
  });
});

describe("sign-in gate", () => {
  const base = {
    aalKnown: true,
    currentLevel: "aal1",
    nextLevel: "aal1",
    emailEnrolled: false,
    emailStepUp: false,
    roleRequiresMfa: true,
  };

  it("sends an authenticator or text user to the challenge until the session is aal2", () => {
    assert.equal(decideMfaGate({ ...base, nextLevel: "aal2" }), "challenge");
    assert.equal(decideMfaGate({ ...base, nextLevel: "aal2", currentLevel: "aal2" }), "allow");
  });

  it("accepts an email proof for this session and ignores one for another", () => {
    assert.equal(decideMfaGate({ ...base, emailEnrolled: true, emailStepUp: false }), "challenge");
    assert.equal(decideMfaGate({ ...base, emailEnrolled: true, emailStepUp: true }), "allow");
    assert.equal(
      decideMfaGate({ ...base, nextLevel: "aal2", emailEnrolled: true, emailStepUp: true, currentLevel: "aal1" }),
      "allow",
    );
    assert.equal(decideMfaGate({ ...base, emailEnrolled: false, emailStepUp: true }), "enroll");
  });

  it("requires setup only for roles that must have a factor, and fails open when assurance is unknown", () => {
    assert.equal(decideMfaGate({ ...base, roleRequiresMfa: false }), "allow");
    assert.equal(decideMfaGate({ ...base, aalKnown: false }), "allow");
    assert.equal(decideMfaGate({ ...base, aalKnown: false, emailEnrolled: true }), "challenge");
  });
});

describe("email step-up cookie", () => {
  it("reads the session id from the access token", () => {
    assert.equal(sessionIdFromAccessToken(header()), sessionId);
    assert.equal(sessionIdFromAccessToken("not-a-jwt"), null);
  });

  it("accepts a signed cookie only for the same user and session", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signMfaEmailStepUp({ uid: userId, sid: sessionId, exp }, secret);
    assert.equal(await readMfaEmailStepUp(token, secret, userId, sessionId), true);
    assert.equal(await readMfaEmailStepUp(token, secret, userId, otherSession), false);
    assert.equal(await readMfaEmailStepUp(token, secret, otherSession, sessionId), false);
    assert.equal(await readMfaEmailStepUp(token, "different-server-secret-value", userId, sessionId), false);
    assert.equal(await readMfaEmailStepUp(`${token}x`, secret, userId, sessionId), false);

    const expired = await signMfaEmailStepUp({ uid: userId, sid: sessionId, exp: Math.floor(Date.now() / 1000) - 5 }, secret);
    assert.equal(await readMfaEmailStepUp(expired, secret, userId, sessionId), false);
  });
});

describe("email factor migration", () => {
  const sql = readFileSync(join(root, "supabase/migrations/00209_staff_email_mfa.sql"), "utf8");

  it("stores a hash, limits guesses and sends, and is closed to the browser", () => {
    assert.match(sql, /code_hash text not null/);
    assert.doesNotMatch(sql, /\bcode text\b/);
    assert.match(sql, /attempts >= 5/);
    assert.match(sql, /interval '60 seconds'/);
    assert.match(sql, /interval '1 hour'/);
    assert.match(sql, /interval '15 minutes'/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on table public\.staff_email_mfa from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.xos_email_mfa_consume\(uuid, uuid, text, text\) to service_role/);
    assert.match(sql, /auth\.role\(\)/);
    assert.doesNotMatch(sql, /grant execute on function public\.xos_email_mfa_begin[\s\S]*to authenticated/);
  });

  it("is wired through the sign-in gate, the challenge screen, and a redacted email log", () => {
    const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
    const challenge = readFileSync(join(root, "src/app/2fa/page.tsx"), "utf8");
    const methodSwitch = readFileSync(join(root, "src/components/MfaMethodSwitch.tsx"), "utf8");
    const security = readFileSync(join(root, "src/components/TwoFactorSetup.tsx"), "utf8");
    const sender = readFileSync(join(root, "src/lib/emailMfaServer.ts"), "utf8");
    const mailer = readFileSync(join(root, "src/lib/mailgun.ts"), "utf8");
    assert.match(middleware, /decideMfaGate/);
    assert.match(middleware, /readMfaEmailStepUp/);
    assert.match(challenge, /MfaMethodSwitch/);
    assert.match(methodSwitch, /Try another way/);
    assert.match(challenge, /channel: "sms"/);
    assert.match(security, /00209_staff_email_mfa\.sql/);
    assert.match(sender, /loggedBodyHtml: EMAIL_MFA_LOG_HTML/);
    assert.match(mailer, /loggedBodyHtml/);
    assert.match(readFileSync(join(root, "src/lib/sendSmsHook.ts"), "utf8"), /smsPhone \|\| userPhone/);
  });
});
