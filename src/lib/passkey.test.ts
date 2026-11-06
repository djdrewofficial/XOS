import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generateAuthenticationOptions, generateRegistrationOptions } from "@simplewebauthn/server";
import { decideMfaGate } from "./mfaGate.ts";
import { readMfaEmailStepUp, signMfaEmailStepUp } from "./mfaStepUpCookie.ts";
import {
  LAST_METHOD_MESSAGE,
  PASSKEY_AUTHENTICATOR_SELECTION,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_PRODUCTION_ORIGIN,
  PASSKEY_UV,
  classifyWebAuthnError,
  cleanPasskeyName,
  clientDataFields,
  counterDecision,
  decideAuthenticationOutcome,
  decideRegistrationOutcome,
  defaultPasskeyName,
  isMissingPasskeySchema,
  passkeyBindingForOrigin,
  passkeyCeremonyMessage,
  passkeyFailureMessage,
  registrationAllowed,
  removalWouldLeaveNone,
  userHandleMatches,
  uuidToBytes,
  webAuthnAuthenticationCheck,
  webAuthnRegistrationCheck,
  type AuthMethodCounts,
} from "./passkey.ts";
import { readMfaPasskeyStepUp, signMfaPasskeyStepUp } from "./passkeyStepUpCookie.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const secret = "xos-passkey-test-pepper";
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const otherSession = "33333333-3333-4333-8333-333333333333";

const methods: AuthMethodCounts = { passkeys: 0, totp: 0, phone: 0, email: 0, otherFactors: 0 };

const proven = {
  verified: true,
  userVerified: true,
  originAllowed: true,
  rpIdMatches: true,
  challengeOk: true,
  credentialFound: true,
  counter: "ok" as const,
  staffUser: true,
  userHandleOk: true,
  nextCounter: 1,
};

describe("relying party", () => {
  const dev = { netlify: false, context: null, deployPrimeUrl: null, siteName: null };
  const production = { netlify: true, context: "production", deployPrimeUrl: null, siteName: "xos" };
  const preview = {
    netlify: true,
    context: "deploy-preview",
    deployPrimeUrl: "https://deploy-preview-12--xos.netlify.app",
    siteName: "xos",
  };

  it("accepts production, localhost, and this site's own preview host", () => {
    assert.deepEqual(passkeyBindingForOrigin(PASSKEY_PRODUCTION_ORIGIN, production), {
      rpId: "xos.xpressdjs.com",
      origin: PASSKEY_PRODUCTION_ORIGIN,
    });
    assert.deepEqual(passkeyBindingForOrigin("http://localhost:3000", dev), {
      rpId: "localhost",
      origin: "http://localhost:3000",
    });
    assert.deepEqual(passkeyBindingForOrigin("http://127.0.0.1:3000", dev), {
      rpId: "127.0.0.1",
      origin: "http://127.0.0.1:3000",
    });
    assert.deepEqual(passkeyBindingForOrigin("https://deploy-preview-12--xos.netlify.app", preview), {
      rpId: "deploy-preview-12--xos.netlify.app",
      origin: "https://deploy-preview-12--xos.netlify.app",
    });
    assert.deepEqual(passkeyBindingForOrigin("https://xos.netlify.app", production), {
      rpId: "xos.netlify.app",
      origin: "https://xos.netlify.app",
    });
  });

  it("refuses other sites, parent domains, preview hosts on production, and localhost on Netlify", () => {
    assert.equal(passkeyBindingForOrigin("https://evil.netlify.app", production), null);
    assert.equal(passkeyBindingForOrigin("https://deploy-preview-12--other.netlify.app", preview), null);
    assert.equal(passkeyBindingForOrigin("https://netlify.app", preview), null);
    assert.equal(passkeyBindingForOrigin(PASSKEY_PRODUCTION_ORIGIN, preview), null);
    assert.equal(passkeyBindingForOrigin("http://localhost:3000", production), null);
    assert.equal(passkeyBindingForOrigin("https://xos.xpressdjs.com.evil.com", production), null);
    assert.equal(passkeyBindingForOrigin("https://xos.xpressdjs.com/login", production), null);
    assert.equal(passkeyBindingForOrigin("https://user:pw@xos.xpressdjs.com", production), null);
    assert.equal(passkeyBindingForOrigin("https://preview--xos.netlify.app.evil.com", preview), null);
  });
});

describe("server verification", () => {
  it("asks the library for user verification, the expected origin, and the stored counter", () => {
    const key = new Uint8Array([1, 2, 3]);
    const check = webAuthnAuthenticationCheck({
      expectedChallenge: "challenge-challenge-challenge-challenge",
      expectedOrigin: PASSKEY_PRODUCTION_ORIGIN,
      expectedRPID: "xos.xpressdjs.com",
      credentialId: "cred",
      publicKey: key,
      counter: 4,
    });
    assert.equal(check.requireUserVerification, true);
    assert.equal(check.expectedOrigin, PASSKEY_PRODUCTION_ORIGIN);
    assert.equal(check.expectedRPID, "xos.xpressdjs.com");
    assert.equal(check.credential.counter, 4);
    assert.equal(check.credential.publicKey, key);
    const registration = webAuthnRegistrationCheck({
      expectedChallenge: check.expectedChallenge,
      expectedOrigin: check.expectedOrigin,
      expectedRPID: check.expectedRPID,
    });
    assert.equal(registration.requireUserVerification, true);
  });

  it("refuses to open a session unless every check passed", () => {
    assert.equal(decideAuthenticationOutcome(proven).ok, true);
    const reasons = [
      "verified",
      "userVerified",
      "originAllowed",
      "rpIdMatches",
      "challengeOk",
      "credentialFound",
      "staffUser",
      "userHandleOk",
    ] as const;
    for (const key of reasons) {
      const decision = decideAuthenticationOutcome({ ...proven, [key]: false });
      assert.equal(decision.ok, false, key);
    }
    assert.equal(decideAuthenticationOutcome({ ...proven, counter: "clone" }).ok, false);
    assert.equal(decideAuthenticationOutcome({ ...proven, counter: "invalid" }).ok, false);
    assert.equal(decideAuthenticationOutcome({ ...proven, nextCounter: -1 }).ok, false);
  });

  it("keeps the same bar for registration", () => {
    assert.equal(
      decideRegistrationOutcome({
        verified: true,
        userVerified: true,
        originAllowed: true,
        rpIdMatches: true,
        challengeOk: true,
        staffUser: true,
      }).ok,
      true,
    );
    assert.equal(
      decideRegistrationOutcome({
        verified: true,
        userVerified: false,
        originAllowed: true,
        rpIdMatches: true,
        challengeOk: true,
        staffUser: true,
      }).ok,
      false,
    );
  });

  it("classifies library failures without repeating their text", () => {
    assert.equal(classifyWebAuthnError(new Error('Response counter value 1 was lower than expected 2')), "counter");
    assert.equal(classifyWebAuthnError(new Error("User verification required, but user could not be verified")), "user_verification");
    assert.equal(classifyWebAuthnError(new Error('Unexpected authentication response origin "https://evil.test"')), "origin");
    assert.equal(classifyWebAuthnError(new Error("Unexpected RP ID")), "rp");
    assert.equal(passkeyFailureMessage("counter").includes("lower than expected"), false);
    assert.match(passkeyFailureMessage("origin"), /address/);
  });

  it("builds discoverable sign-in and registration options with verification required", async () => {
    const auth = await generateAuthenticationOptions({
      rpID: "xos.xpressdjs.com",
      userVerification: PASSKEY_UV,
    });
    assert.equal(auth.userVerification, "required");
    assert.equal(auth.rpId, "xos.xpressdjs.com");
    assert.equal(auth.allowCredentials, undefined);
    assert.equal(auth.challenge.length >= 32, true);

    const userID = uuidToBytes(userId);
    assert.ok(userID);
    const registration = await generateRegistrationOptions({
      rpName: "XOS",
      rpID: "localhost",
      userName: "drew@xpressdjs.com",
      userID,
      attestationType: "none",
      authenticatorSelection: PASSKEY_AUTHENTICATOR_SELECTION,
    });
    assert.equal(registration.rp.id, "localhost");
    assert.equal(registration.authenticatorSelection?.userVerification, "required");
    assert.equal(registration.authenticatorSelection?.residentKey, "required");
    const fields = clientDataFields(Buffer.from(JSON.stringify({
      type: "webauthn.get",
      challenge: registration.challenge,
      origin: "http://localhost:3000",
    })).toString("base64url"));
    assert.equal(fields?.challenge, registration.challenge);
    assert.equal(userHandleMatches(Buffer.from(userID).toString("base64url"), userId), true);
    assert.equal(userHandleMatches(Buffer.from(new Uint8Array(16)).toString("base64url"), userId), false);
    assert.equal(userHandleMatches(undefined, userId), true);
  });
});

describe("signature counter", () => {
  it("accepts a synced passkey that stays at zero and a counter that moves up", () => {
    assert.equal(counterDecision(0, 0), "ok");
    assert.equal(counterDecision(0, 1), "ok");
    assert.equal(counterDecision(4, 5), "ok");
  });

  it("rejects a repeated or rewound counter once one has been recorded", () => {
    assert.equal(counterDecision(4, 4), "clone");
    assert.equal(counterDecision(4, 3), "clone");
    assert.equal(counterDecision(4, 0), "clone");
    assert.equal(counterDecision(-1, 0), "invalid");
    assert.equal(counterDecision(1.5, 2), "invalid");
  });
});

describe("enrollment and removal", () => {
  it("lets a password session add the first method, and nothing further until the session is verified", () => {
    assert.equal(registrationAllowed({ sessionSatisfied: false, methodCount: 0 }), true);
    assert.equal(registrationAllowed({ sessionSatisfied: false, methodCount: 1 }), false);
    assert.equal(registrationAllowed({ sessionSatisfied: true, methodCount: 2 }), true);
  });

  it("refuses to remove the last passkey or the last second factor", () => {
    assert.equal(removalWouldLeaveNone({ ...methods, passkeys: 1 }, "passkeys"), true);
    assert.equal(removalWouldLeaveNone({ ...methods, passkeys: 1, totp: 1 }, "passkeys"), false);
    assert.equal(removalWouldLeaveNone({ ...methods, totp: 1, email: 1 }, "email"), false);
    assert.equal(removalWouldLeaveNone({ ...methods, email: 1 }, "email"), true);
    assert.equal(removalWouldLeaveNone({ ...methods, phone: 2 }, "phone"), false);
    assert.equal(removalWouldLeaveNone({ ...methods }, "totp"), true);
    assert.equal(passkeyFailureMessage("last"), LAST_METHOD_MESSAGE);
  });

  it("requires every staff role to have a passkey or a second factor", () => {
    const permissions = readFileSync(join(root, "src/lib/permissions.ts"), "utf8");
    assert.match(permissions, /ROLES\.map\(\(\[id\]\) => id\)/);
    assert.doesNotMatch(permissions, /Regular "employee" stays opt-in/);
    assert.equal(
      decideMfaGate({
        aalKnown: true,
        currentLevel: "aal1",
        nextLevel: "aal1",
        emailEnrolled: false,
        emailStepUp: false,
        passkeyEnrolled: false,
        passkeyStepUp: false,
        roleRequiresMfa: true,
      }),
      "enroll",
    );
  });
});

describe("passkey step-up cookie", () => {
  it("accepts a signed passkey cookie only for the same user and session", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signMfaPasskeyStepUp({ uid: userId, sid: sessionId, exp }, secret);
    assert.equal(await readMfaPasskeyStepUp(token, secret, userId, sessionId), true);
    assert.equal(await readMfaPasskeyStepUp(token, secret, userId, otherSession), false);
    assert.equal(await readMfaPasskeyStepUp(token, secret, otherSession, sessionId), false);
    const email = await signMfaEmailStepUp({ uid: userId, sid: sessionId, exp }, secret);
    assert.equal(await readMfaPasskeyStepUp(email, secret, userId, sessionId), false);
    assert.equal(await readMfaEmailStepUp(token, secret, userId, sessionId), false);
    const expired = await signMfaPasskeyStepUp({ uid: userId, sid: sessionId, exp: Math.floor(Date.now() / 1000) - 5 }, secret);
    assert.equal(await readMfaPasskeyStepUp(expired, secret, userId, sessionId), false);
  });
});

describe("names and setup copy", () => {
  it("names a device and keeps a custom name inside 80 characters", () => {
    assert.equal(defaultPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 17)", true), "iPhone or iPad passkey");
    assert.equal(defaultPasskeyName("Mozilla/5.0 (Macintosh)", false), "Mac");
    assert.equal(cleanPasskeyName("  Drew's iPhone \n", "Passkey"), "Drew's iPhone");
    assert.equal(cleanPasskeyName("", "Mac"), "Mac");
    assert.equal(cleanPasskeyName("x".repeat(200), "Passkey").length, 80);
  });

  it("recognizes a missing migration without treating every error as setup", () => {
    assert.equal(isMissingPasskeySchema("Could not find the table public.staff_passkeys in the schema cache"), true);
    assert.equal(isMissingPasskeySchema("Could not find the function public.xos_passkey_challenge_begin"), true);
    assert.equal(isMissingPasskeySchema("Could not find the user"), false);
    assert.equal(passkeyCeremonyMessage({ name: "AbortError" }), null);
    assert.match(passkeyCeremonyMessage({ name: "NotAllowedError" }) ?? "", /closed/);
  });
});

describe("passkey migration and session minting", () => {
  const sql = readFileSync(join(root, "supabase/migrations/00210_staff_passkeys.sql"), "utf8");
  const server = readFileSync(join(root, "src/lib/passkeyServer.ts"), "utf8");

  it("stores challenges once, limits their life, and keeps the tables off the browser", () => {
    assert.match(sql, /interval '5 minutes'/);
    assert.match(sql, /consumed_at is null/);
    assert.match(sql, /status', 'used'/);
    assert.match(sql, /status', 'clone'/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on table public\.staff_passkeys from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.xos_passkey_challenge_consume\(text, text, uuid, uuid\) to service_role/);
    assert.match(sql, /auth\.role\(\)/);
    assert.match(sql, /last_method/);
    assert.match(sql, /xos_passkey_user_delete/);
    assert.doesNotMatch(sql, /grant execute on function public\.xos_passkey_challenge_begin[\s\S]*to authenticated/);
    assert.equal(PASSKEY_CHALLENGE_TTL_MS, 5 * 60 * 1000);
  });

  it("opens a Supabase session only after the assertion is accepted, and never returns the token", () => {
    const decision = server.indexOf("if (!decision.ok) return fail(decision.reason);");
    const mint = server.indexOf("const minted = await mintStaffSession");
    assert.ok(decision > 0 && mint > decision);
    assert.match(server, /type:\s*"magiclink"/);
    assert.match(server, /verifyOtp\(\{\s*token_hash:\s*tokenHash,\s*type:\s*"magiclink"/);
    assert.match(server, /requireUserVerification:\s*true/);
    assert.match(server, /hashed_token/);
    assert.doesNotMatch(server, /return\s*\{[^}]*hashed_token/);
    assert.doesNotMatch(server, /console\.(log|error|info)\([^)]*tokenHash/);
    const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
    assert.match(middleware, /readMfaPasskeyStepUp/);
    assert.match(middleware, /\/api\/passkey\/authenticate\/verify/);
    const security = readFileSync(join(root, "src/app/(app)/account/security/page.tsx"), "utf8");
    assert.match(security, /PasskeyManager/);
    const login = readFileSync(join(root, "src/app/login/page.tsx"), "utf8");
    assert.match(login, /Sign in with a passkey|PasskeyLogin/);
    assert.match(login, /username webauthn/);
  });
});
