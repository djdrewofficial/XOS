import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { passwordResetHostAllowed, recoveryConfirmPath, safeRecoveryToken } from "./passwordResetPath.ts";

describe("recovery confirm path", () => {
  it("forwards only a recovery token to the set-password page", () => {
    const params = new URLSearchParams({
      token_hash: "abcDEF_123-token",
      type: "recovery",
      next: "https://evil.example/phish",
      redirect_to: "https://evil.example/phish",
    });
    assert.equal(
      recoveryConfirmPath(params),
      "/auth/reset?token_hash=abcDEF_123-token&type=recovery",
    );
  });

  it("drops signup tokens, empty tokens, and tokens that can change the path", () => {
    assert.equal(recoveryConfirmPath(new URLSearchParams({ token_hash: "abc", type: "signup" })), "/auth/reset");
    assert.equal(recoveryConfirmPath(new URLSearchParams({ token_hash: "abc", type: "magiclink" })), "/auth/reset");
    assert.equal(recoveryConfirmPath(new URLSearchParams({ type: "recovery" })), "/auth/reset");
    assert.equal(safeRecoveryToken("abc/../admin"), null);
    assert.equal(safeRecoveryToken("abc?x=1"), null);
    assert.equal(safeRecoveryToken("abc#hash"), null);
    assert.equal(safeRecoveryToken("abc def"), null);
    assert.equal(recoveryConfirmPath(new URLSearchParams({ token_hash: "abc/../x", type: "recovery" })), "/auth/reset");
  });
});

describe("password reset host", () => {
  it("allows our site and rejects a foreign host", () => {
    assert.equal(passwordResetHostAllowed("xos.xpressdjs.com", null), true);
    assert.equal(passwordResetHostAllowed("preview.netlify.app", null), true);
    assert.equal(passwordResetHostAllowed("evil.example", "xos.xpressdjs.com"), false);
    assert.equal(passwordResetHostAllowed("evil.example", "evil.example"), true);
  });
});
