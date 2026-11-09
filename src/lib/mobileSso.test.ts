import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  expoHostsFromEnv,
  pkceChallengeFor,
  readMobileSsoCode,
  safeMobileReturnUrl,
  signMobileSsoCode,
  validCodeChallenge,
  validCodeVerifier,
} from "./mobileSso.ts";

const SECRET = "test-secret-0123456789abcdef";
const UID = "11111111-2222-4333-8444-555555555555";
const JTI = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VERIFIER = "v".repeat(30) + "_-.~" + "A".repeat(20);

describe("mobile sso return url", () => {
  it("accepts the app scheme and Expo Go on this machine or the LAN", () => {
    for (const ok of [
      "xosmobile://auth/sso",
      "exp://192.168.1.20:8081/--/auth/sso",
      "exp://10.0.0.5:8081/--/auth/sso",
      "exp://172.20.1.2:8081/--/auth/sso",
      "exp://127.0.0.1:8095/--/auth/sso",
      "exp://localhost:8081/--/auth/sso",
    ]) {
      assert.equal(safeMobileReturnUrl(ok), ok, ok);
    }
  });
  it("only allows public Expo hosts listed in env", () => {
    const tunnel = "exp://abc-anonymous-8081.exp.direct/--/auth/sso";
    assert.equal(safeMobileReturnUrl(tunnel), null);
    assert.equal(safeMobileReturnUrl(tunnel, expoHostsFromEnv(" abc-anonymous-8081.exp.direct ,bad host")), tunnel);
  });
  it("rejects anything else", () => {
    for (const bad of [
      null,
      "",
      "https://evil.example/--/auth/sso",
      "exp://evil.example/--/auth/sso",
      "exp://8.8.8.8:8081/--/auth/sso",
      "exp://172.32.0.1:8081/--/auth/sso",
      "exp://192.168.1.999:8081/--/auth/sso",
      "xosmobile://auth/sso?x=1",
      "xosmobile://auth/sso#x",
      "xosmobile://evil/sso",
      "exp://u:p@192.168.1.2/--/auth/sso",
      "exp://192.168.1.2/--/auth/other",
      "exp://192.168.1.2/--/auth/sso?code=1",
      "javascript:alert(1)",
      "exp://192.168.1.2 /--/auth/sso",
    ]) {
      assert.equal(safeMobileReturnUrl(bad), null, String(bad));
    }
  });
});

describe("mobile sso code", () => {
  it("round-trips with the right verifier", async () => {
    const ch = await pkceChallengeFor(VERIFIER);
    assert.ok(validCodeChallenge(ch));
    assert.ok(validCodeVerifier(VERIFIER));
    const now = 1_800_000_000;
    const code = await signMobileSsoCode({ uid: UID, ch, jti: JTI, exp: now + 120 }, SECRET);
    const claims = await readMobileSsoCode(code, VERIFIER, SECRET, now);
    assert.equal(claims?.uid, UID);
    assert.equal(claims?.jti, JTI);
  });
  it("is S256 (base64url sha256, no padding)", async () => {
    const expected = createHash("sha256").update(VERIFIER).digest("base64url");
    assert.equal(await pkceChallengeFor(VERIFIER), expected);
  });
  it("rejects a wrong verifier, expiry, tampering, and a wrong secret", async () => {
    const ch = await pkceChallengeFor(VERIFIER);
    const now = 1_800_000_000;
    const code = await signMobileSsoCode({ uid: UID, ch, jti: JTI, exp: now + 120 }, SECRET);
    assert.equal(await readMobileSsoCode(code, "w".repeat(50), SECRET, now), null);
    assert.equal(await readMobileSsoCode(code, VERIFIER, SECRET, now + 121), null);
    assert.equal(await readMobileSsoCode(code, VERIFIER, "another-secret-0123456789", now), null);
    const [payload, sig] = code.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, uid: UID, ch, jti: JTI, exp: now + 99999 })).toString("base64url");
    assert.equal(await readMobileSsoCode(`${forged}.${sig}`, VERIFIER, SECRET, now), null);
    assert.equal(await readMobileSsoCode(`${payload}.${sig}x`, VERIFIER, SECRET, now), null);
    assert.equal(await readMobileSsoCode(`${payload}`, VERIFIER, SECRET, now), null);
  });
  it("refuses a code that claims a long life", async () => {
    const ch = await pkceChallengeFor(VERIFIER);
    const now = 1_800_000_000;
    const code = await signMobileSsoCode({ uid: UID, ch, jti: JTI, exp: now + 3600 }, SECRET);
    assert.equal(await readMobileSsoCode(code, VERIFIER, SECRET, now), null);
  });
});
