import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { validatePasswordChange } from "./passwordPolicy.ts";
import {
  PASSWORD_CHANGE_MFA_PROMPT,
  classifyCurrentPasswordError,
  currentPasswordErrorMessage,
  isInsufficientAal,
  isInvalidNonce,
  isReauthenticationNeeded,
  needsAuthenticatorStepUp,
  nextPasswordChangeStep,
  passwordUpdateErrorMessage,
  sessionNeedsTotpBeforePasswordChange,
  totpCodeError,
} from "./passwordChange.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STRONG = "Correct-horse-1";

describe("validatePasswordChange", () => {
  it("accepts a policy-compliant password that differs from the current one", () => {
    assert.deepEqual(validatePasswordChange({ current: "old-password", next: STRONG, confirm: STRONG }), { ok: true });
  });

  it("rejects an empty current password, a mismatch, a reuse, and a weak new password", () => {
    assert.equal(validatePasswordChange({ current: "", next: STRONG, confirm: STRONG }).ok, false);
    assert.equal(
      validatePasswordChange({ current: "old-password", next: STRONG, confirm: "Correct-horse-2" }).ok,
      false,
    );
    const same = validatePasswordChange({ current: STRONG, next: STRONG, confirm: STRONG });
    assert.equal(same.ok, false);
    if (!same.ok) assert.match(same.error, /different/);
    const weak = validatePasswordChange({ current: "old-password", next: "short", confirm: "short" });
    assert.equal(weak.ok, false);
    if (!weak.ok) assert.match(weak.error, /requirements/);
  });

  it("rejects a password longer than 256 characters", () => {
    const next = `A1!${"a".repeat(260)}`;
    const result = validatePasswordChange({ current: "old-password", next, confirm: next });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /too long/);
  });
});

describe("current password check", () => {
  it("treats a weak-password rejection as proof the current password matched", () => {
    assert.equal(classifyCurrentPasswordError(null), "match");
    assert.equal(classifyCurrentPasswordError({ code: "weak_password", message: "weak" }), "match");
  });

  it("tells a wrong password and a rate limit apart from other failures", () => {
    assert.equal(classifyCurrentPasswordError({ code: "invalid_credentials" }), "wrong");
    assert.equal(
      classifyCurrentPasswordError({ message: "Invalid login credentials" }),
      "wrong",
    );
    assert.equal(classifyCurrentPasswordError({ code: "over_request_rate_limit" }), "rate_limited");
    assert.equal(classifyCurrentPasswordError({ code: "email_not_confirmed", message: "Confirm your email" }), "unavailable");
    assert.match(currentPasswordErrorMessage("wrong"), /incorrect/i);
    assert.match(currentPasswordErrorMessage("rate_limited"), /few minutes/);
    assert.match(currentPasswordErrorMessage("unavailable", { message: "Confirm your email" }), /Confirm your email/);
  });
});

describe("updateUser next step", () => {
  it("asks for an authenticator code when the session is only aal1", () => {
    assert.equal(needsAuthenticatorStepUp({ currentLevel: "aal1", nextLevel: "aal2" }), true);
    assert.equal(needsAuthenticatorStepUp({ currentLevel: "aal2", nextLevel: "aal2" }), false);
    assert.equal(needsAuthenticatorStepUp({ currentLevel: "aal1", nextLevel: "aal1" }), false);
    assert.equal(needsAuthenticatorStepUp(null), false);
    assert.equal(totpCodeError("12345"), PASSWORD_CHANGE_MFA_PROMPT);
    assert.equal(totpCodeError(" 123456 "), null);

    const step = nextPasswordChangeStep({
      error: { message: "AAL2 session is required to update email or password when MFA is enabled." },
      hasNonce: false,
    });
    assert.equal(step.action, "step-up-mfa");
  });

  it("replaces the reset-page MFA refusal with a plain authenticator prompt", () => {
    const raw = "AAL2 session is required to update email or password when MFA is enabled.";
    assert.equal(isInsufficientAal({ code: "insufficient_aal", message: raw }), true);
    assert.equal(
      nextPasswordChangeStep({ error: { code: "insufficient_aal", message: raw }, hasNonce: false }).action,
      "step-up-mfa",
    );
    const plain = passwordUpdateErrorMessage({ message: raw });
    assert.equal(plain, PASSWORD_CHANGE_MFA_PROMPT);
    assert.equal(plain.includes("AAL2"), false);
  });

  it("does not ask for a code when there is no authenticator, and does when a recovery session hid the factor", () => {
    assert.equal(
      sessionNeedsTotpBeforePasswordChange({
        aal: { currentLevel: "aal1", nextLevel: "aal1" },
        hasVerifiedTotp: false,
      }),
      false,
    );
    assert.equal(
      sessionNeedsTotpBeforePasswordChange({
        aal: { currentLevel: "aal2", nextLevel: "aal2" },
        hasVerifiedTotp: true,
      }),
      false,
    );
    assert.equal(
      sessionNeedsTotpBeforePasswordChange({
        aal: { currentLevel: "aal1", nextLevel: "aal2" },
        hasVerifiedTotp: true,
      }),
      true,
    );
    // Recovery JWT is aal1. If the session user omitted factors, nextLevel stays
    // aal1, but a verified factor from listFactors still blocks the update.
    assert.equal(
      sessionNeedsTotpBeforePasswordChange({
        aal: { currentLevel: "aal1", nextLevel: "aal1" },
        hasVerifiedTotp: true,
      }),
      true,
    );
  });

  it("sends a nonce instead of signing in again when secure password change asks for reauthentication", () => {
    assert.equal(isReauthenticationNeeded({ code: "reauthentication_needed" }), true);
    assert.equal(
      isReauthenticationNeeded({ message: "Password update requires reauthentication" }),
      true,
    );
    assert.equal(isInvalidNonce({ message: "Invalid nonce" }), true);
    assert.equal(isReauthenticationNeeded({ message: "Invalid nonce" }), false);

    assert.deepEqual(
      nextPasswordChangeStep({ error: { code: "reauthentication_needed" }, hasNonce: false }),
      { action: "send-nonce" },
    );
    const again = nextPasswordChangeStep({
      error: { code: "reauthentication_needed", message: "Password update requires reauthentication" },
      hasNonce: true,
    });
    assert.equal(again.action, "fail");
    if (again.action === "fail") assert.match(again.error, /confirmation code/);
  });

  it("keeps GoTrue's weak-password text and rewrites same-password", () => {
    assert.match(
      passwordUpdateErrorMessage({ code: "weak_password", message: "Password is known to be weak and easy to guess" }),
      /known to be weak/,
    );
    assert.match(passwordUpdateErrorMessage({ code: "same_password" }), /different/);
    const step = nextPasswordChangeStep({
      error: { code: "same_password" },
      hasNonce: false,
    });
    assert.equal(step.action, "fail");
  });
});

describe("My Account surfaces the change-password section", () => {
  it("renders the section on the profile page and the security page, and the reset page can step up", () => {
    const account = readFileSync(join(root, "src/app/(app)/account/page.tsx"), "utf8");
    const security = readFileSync(join(root, "src/app/(app)/account/security/page.tsx"), "utf8");
    const form = readFileSync(join(root, "src/components/ChangePasswordForm.tsx"), "utf8");
    const setPassword = readFileSync(join(root, "src/app/auth/set-password/page.tsx"), "utf8");
    const twoFa = readFileSync(join(root, "src/app/2fa/page.tsx"), "utf8");
    assert.match(account, /ChangePasswordSection/);
    assert.match(account, /#change-password/);
    assert.match(security, /ChangePasswordSection/);
    assert.match(form, /emailMyPasswordReset/);
    assert.match(form, /PasswordChecklist/);
    assert.match(form, /MfaPasswordStep/);
    assert.match(setPassword, /elevateSessionWithTotp/);
    assert.match(setPassword, /passwordChangeNeedsTotp/);
    assert.match(setPassword, /MfaPasswordStep/);
    assert.doesNotMatch(setPassword, /AAL2 session is required/);
    assert.match(twoFa, /elevateSessionWithTotp/);
    assert.match(setPassword, /router\.push\("\/"\)/);
  });
});
