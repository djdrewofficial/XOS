import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { appleTeamId, APPLE_TEAM_ID, CLIENT_IOS_BUNDLE_ID } from "./clientApp.ts";
import { decideAuthenticationOutcome } from "./passkey.ts";
import { safeStaffNext, ssoNeedsStaffGate, staffCallbackUrl, staffIdentityAllowed } from "./staffSso.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("staff identity after Google or Apple", () => {
  it("refuses a client or guest and does not invent a staff row", () => {
    assert.equal(staffIdentityAllowed({ accountType: "client", employeeLinked: false, ownerEmail: false }), false);
    assert.equal(staffIdentityAllowed({ accountType: "event_guest", employeeLinked: false, ownerEmail: false }), false);
    assert.equal(staffIdentityAllowed({ accountType: "client", employeeLinked: false, ownerEmail: true }), false);
    assert.equal(staffIdentityAllowed({ accountType: null, employeeLinked: false, ownerEmail: false }), false);
  });

  it("allows an existing staff login, employee link, or owner email", () => {
    assert.equal(staffIdentityAllowed({ accountType: "staff", employeeLinked: true, ownerEmail: false }), true);
    assert.equal(staffIdentityAllowed({ accountType: null, employeeLinked: true, ownerEmail: false }), true);
    assert.equal(staffIdentityAllowed({ accountType: null, employeeLinked: false, ownerEmail: true }), true);
  });

  it("still sends social sign-in through the passkey or second-factor gate", () => {
    assert.equal(ssoNeedsStaffGate({ currentLevel: "aal1", nextLevel: "aal2", emailMfa: false, passkeyMfa: false }), true);
    assert.equal(ssoNeedsStaffGate({ currentLevel: "aal1", nextLevel: "aal1", emailMfa: false, passkeyMfa: true }), true);
    assert.equal(ssoNeedsStaffGate({ currentLevel: "aal1", nextLevel: "aal1", emailMfa: true, passkeyMfa: false }), true);
    assert.equal(ssoNeedsStaffGate({ currentLevel: "aal2", nextLevel: "aal2", emailMfa: true, passkeyMfa: true }), false);
    assert.equal(ssoNeedsStaffGate({ currentLevel: "aal1", nextLevel: "aal1", emailMfa: false, passkeyMfa: false }), false);
  });
});

describe("return urls", () => {
  it("allows only a local /sso path", () => {
    assert.equal(safeStaffNext("/sso/gallery"), "/sso/gallery");
    assert.equal(safeStaffNext("https://evil.example/sso/gallery"), null);
    assert.equal(safeStaffNext("//evil.example"), null);
    assert.equal(safeStaffNext("/events/1"), null);
    assert.equal(safeStaffNext("/sso/ok\nSet-Cookie"), null);
    const callback = staffCallbackUrl("https://xos.xpressdjs.com", "/sso/gallery");
    assert.equal(callback, "https://xos.xpressdjs.com/auth/callback?next=%2Fsso%2Fgallery");
    assert.equal(staffCallbackUrl("https://user:pw@xos.xpressdjs.com", null), null);
  });
});

describe("passkey roles stay split", () => {
  const base = {
    verified: true,
    userVerified: true,
    originAllowed: true,
    rpIdMatches: true,
    challengeOk: true,
    credentialFound: true,
    counter: "ok" as const,
    userHandleOk: true,
    nextCounter: 1,
  };

  it("opens a staff session only for a staff user", () => {
    assert.equal(decideAuthenticationOutcome({ ...base, staffUser: true }).ok, true);
    const client = decideAuthenticationOutcome({ ...base, staffUser: false });
    assert.equal(client.ok, false);
    if (!client.ok) assert.equal(client.reason, "staff");
  });
});

describe("sign-in files", () => {
  const login = readFileSync(join(root, "src/app/login/page.tsx"), "utf8");
  const callback = readFileSync(join(root, "src/app/auth/callback/route.ts"), "utf8");
  const aasa = readFileSync(join(root, "src/app/.well-known/apple-app-site-association/route.ts"), "utf8");
  const staffPasskey = readFileSync(join(root, "src/lib/passkeyServer.ts"), "utf8");

  it("shows Passkey, Email, Google, and Apple before the password form", () => {
    const passkey = login.indexOf("<PasskeyLogin");
    const email = login.indexOf('label="Email"');
    const google = login.indexOf('label="Google"');
    const apple = login.indexOf('label="Apple"');
    assert.ok(passkey > 0 && email > passkey && google > email && apple > google);
    assert.match(login, /username webauthn/);
    assert.match(login, /Forgot password/);
    assert.match(login, /signInWithOAuth/);
    assert.match(login, /Back/);
    assert.doesNotMatch(login, /MFA_PASSKEY_COOKIE/);
  });

  it("rejects a non-staff social login without setting the passkey cookie", () => {
    assert.match(callback, /staffIdentityAllowed/);
    assert.match(callback, /signOut\(\{\s*scope:\s*"local"\s*\}\)/);
    assert.match(callback, /ssoNeedsStaffGate/);
    assert.match(callback, /passkeyMfa: meta\.passkey_mfa === true/);
    assert.doesNotMatch(callback, /MFA_PASSKEY_COOKIE/);
    assert.doesNotMatch(callback, /passkey_mfa:\s*true/);
    assert.doesNotMatch(callback, /from\("accounts"\)\.insert/);
    assert.doesNotMatch(callback, /from\("employees"\)\.update/);
  });

  it("keeps staff passkeys off the couple-app tables", () => {
    assert.match(staffPasskey, /staff_passkeys/);
    assert.doesNotMatch(staffPasskey, /app_passkeys/);
    assert.match(staffPasskey, /stampPasskeyCookie/);
  });

  it("serves webcredentials and the join-link applink for the confirmed team", () => {
    assert.equal(APPLE_TEAM_ID, "VH9Z63JB8L");
    assert.equal(appleTeamId(undefined), "VH9Z63JB8L");
    assert.equal(appleTeamId(" ABCDE12345 "), "ABCDE12345");
    assert.match(aasa, /webcredentials/);
    assert.match(aasa, /applinks/);
    assert.match(aasa, /\/j\/\*/);
    assert.match(aasa, /CLIENT_IOS_BUNDLE_ID/);
    assert.equal(CLIENT_IOS_BUNDLE_ID, "com.xpressentertainment.client");
    assert.doesNotMatch(login, /auth\.passkey/);
  });

  it("matches the installed Auth passkey HTTP routes, not a second XOS ceremony", () => {
    const auth = readFileSync(join(root, "node_modules/@supabase/auth-js/src/GoTrueClient.ts"), "utf8");
    for (const path of [
      "/passkeys/authentication/options",
      "/passkeys/authentication/verify",
      "/passkeys/registration/options",
      "/passkeys/registration/verify",
      "/passkeys/${params.passkeyId}",
    ]) {
      assert.match(auth, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(auth, /experimental\.passkey/);
    assert.doesNotMatch(login, /\/api\/mobile\/passkey/);
  });
});
