import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { appleClientSecret, appleSignInConfig, revokeAppleAuthorization } from "./appleSignIn.ts";
import { deleteAppAccountDecision, readAppleAuthorizationCode, runAppAccountDeletion } from "./deleteAppAccount.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const route = readFileSync(join(root, "src/app/api/mobile/delete-account/route.ts"), "utf8");

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = {
  APPLE_SIGNIN_KEY_ID: "KEYID12345",
  APPLE_SIGNIN_PRIVATE_KEY: pem.replace(/\n/g, "\\n"),
  APPLE_TEAM_ID: "TEAMID1234",
  APPLE_CLIENT_ID: "com.xpressentertainment.client",
};

describe("delete app account decision", () => {
  it("refuses staff and allows a couple or guest login", () => {
    assert.equal(deleteAppAccountDecision({ accountType: "staff", employeeId: "emp", linkedEmployee: true }).ok, false);
    assert.equal(deleteAppAccountDecision({ accountType: "client", employeeId: null, linkedEmployee: true }).ok, false);
    assert.equal(deleteAppAccountDecision({ accountType: "client", employeeId: "emp", linkedEmployee: false }).ok, false);
    assert.equal(deleteAppAccountDecision({ accountType: "client", employeeId: null, linkedEmployee: false }).ok, true);
    assert.equal(deleteAppAccountDecision({ accountType: "event_guest", employeeId: null, linkedEmployee: false }).ok, true);
    assert.equal(deleteAppAccountDecision({ accountType: null, employeeId: null, linkedEmployee: false }).ok, true);
  });

  it("reads an optional Apple code and ignores anything else", () => {
    assert.equal(readAppleAuthorizationCode(null), null);
    assert.equal(readAppleAuthorizationCode({}), null);
    assert.equal(readAppleAuthorizationCode({ appleAuthorizationCode: "  " }), null);
    assert.equal(readAppleAuthorizationCode({ appleAuthorizationCode: " code-1 " }), "code-1");
    assert.equal(readAppleAuthorizationCode({ appleAuthorizationCode: 4 }), null);
  });
});

describe("Apple token revoke", () => {
  it("signs a client secret with the key id, team, and bundle id", () => {
    const config = appleSignInConfig(env);
    assert.ok(config);
    const jwt = appleClientSecret(config, 1_700_000_000);
    const [header, payload, sig] = jwt.split(".");
    assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).kid, "KEYID12345");
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as { iss: string; sub: string; aud: string };
    assert.equal(body.iss, "TEAMID1234");
    assert.equal(body.sub, "com.xpressentertainment.client");
    assert.equal(body.aud, "https://appleid.apple.com");
    assert.ok(sig);
    assert.equal(appleSignInConfig({}), null);
  });

  it("exchanges the code and revokes the refresh token", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).endsWith("/auth/token")) {
        return new Response(JSON.stringify({ refresh_token: "refresh-1", access_token: "access-1" }), { status: 200 });
      }
      return new Response("", { status: 200 });
    };
    const result = await revokeAppleAuthorization({ code: "auth-code", env, nowSec: 1_700_000_000, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/auth\/token$/);
    assert.match(calls[0].body, /grant_type=authorization_code/);
    assert.match(calls[0].body, /code=auth-code/);
    assert.match(calls[1].url, /\/auth\/revoke$/);
    assert.match(calls[1].body, /token=refresh-1/);
    assert.match(calls[1].body, /token_type_hint=refresh_token/);
    assert.equal(calls[1].body.includes(pem), false);
  });

  it("returns a failure when Apple rejects the code and does not revoke", async () => {
    let revoked = false;
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/auth/revoke")) revoked = true;
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    };
    const result = await revokeAppleAuthorization({ code: "bad", env, fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /400/);
    assert.equal(revoked, false);
    const missing = await revokeAppleAuthorization({ code: "bad", env: {}, fetchImpl });
    assert.equal(missing.ok, false);
  });
});

describe("run deletion", () => {
  it("still deletes the login when Apple revoke fails", async () => {
    const logs: string[] = [];
    const steps: string[] = [];
    const result = await runAppAccountDeletion({
      accountType: "client",
      employeeId: null,
      linkedEmployee: false,
      appleAuthorizationCode: "auth-code",
      env: {},
      log: (message) => logs.push(message),
      revoke: async () => ({ ok: false, error: "Apple token exchange failed (400)." }),
      removeAppData: async () => {
        steps.push("membership");
      },
      deleteAuthUser: async () => {
        steps.push("auth");
        return null;
      },
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(steps, ["membership", "auth"]);
    assert.match(logs[0] ?? "", /Apple token revoke failed/);
    assert.equal((logs[0] ?? "").includes("auth-code"), false);
  });

  it("does not delete a staff login", async () => {
    let deleted = false;
    const result = await runAppAccountDeletion({
      accountType: "staff",
      employeeId: "emp",
      linkedEmployee: true,
      appleAuthorizationCode: "auth-code",
      env,
      removeAppData: async () => {
        deleted = true;
      },
      deleteAuthUser: async () => {
        deleted = true;
        return null;
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
    assert.equal(deleted, false);
  });
});

describe("delete-account route", () => {
  it("removes the login and membership, and leaves Xpress records alone", () => {
    assert.match(route, /runAppAccountDeletion/);
    assert.match(route, /event_app_members/);
    assert.match(route, /device_tokens/);
    assert.match(route, /accounts/);
    assert.match(route, /deleteUser/);
    assert.match(route, /appleAuthorizationCode/);
    assert.equal(route.includes('.from("events")'), false);
    assert.equal(route.includes('.from("documents")'), false);
    assert.equal(route.includes('.from("clients")'), false);
    assert.equal(route.includes('.from("payments")'), false);
    assert.equal(route.includes('.from("event_clients")'), false);
    assert.equal(route.includes('.from("employees").update'), false);
  });
});
