import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { passwordResetHostAllowed, safeRecoveryToken, sameHostRecoveryRedirect } from "./passwordResetPath.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function rootUrl(search: string, origin = "https://xos.xpressdjs.com") {
  return new URL(`/${search}`, origin);
}

describe("root recovery redirect", () => {
  it("sends a signed-out root recovery link to the same host set-password page", () => {
    const dest = sameHostRecoveryRedirect(rootUrl("?token_hash=abcDEF_123-token&type=recovery"));
    assert.equal(dest?.href, "https://xos.xpressdjs.com/auth/set-password?token_hash=abcDEF_123-token&type=recovery");
  });

  it("sends the same root recovery link for a signed-in visit on another allowed host", () => {
    const dest = sameHostRecoveryRedirect(
      rootUrl("?token_hash=abcDEF_123-token&type=recovery", "https://deploy-preview-49--xos-xpressdjs.netlify.app"),
    );
    assert.equal(
      dest?.href,
      "https://deploy-preview-49--xos-xpressdjs.netlify.app/auth/set-password?token_hash=abcDEF_123-token&type=recovery",
    );
  });

  it("drops next, redirect_to, and every other parameter", () => {
    const dest = sameHostRecoveryRedirect(
      rootUrl("?token_hash=abc&type=recovery&next=https://evil.example/phish&redirect_to=//evil.example&code=signup"),
    );
    assert.equal(dest?.origin, "https://xos.xpressdjs.com");
    assert.equal(dest?.pathname, "/auth/set-password");
    assert.deepEqual([...dest!.searchParams.keys()], ["token_hash", "type"]);
    assert.equal(dest?.searchParams.get("token_hash"), "abc");
    assert.equal(dest?.searchParams.get("type"), "recovery");
    assert.equal(dest?.protocol, "https:");
  });

  it("leaves a normal root visit, another path, and a bad type alone", () => {
    assert.equal(sameHostRecoveryRedirect(rootUrl("")), null);
    assert.equal(sameHostRecoveryRedirect(rootUrl("?tab=events")), null);
    assert.equal(sameHostRecoveryRedirect(new URL("https://xos.xpressdjs.com/login?token_hash=abc&type=recovery")), null);
    assert.equal(sameHostRecoveryRedirect(rootUrl("?token_hash=abc&type=signup")), null);
    assert.equal(sameHostRecoveryRedirect(rootUrl("?token_hash=abc&type=magiclink")), null);
    assert.equal(sameHostRecoveryRedirect(rootUrl("?type=recovery")), null);
    assert.equal(sameHostRecoveryRedirect(rootUrl("?token_hash=abc")), null);
  });

  it("rejects malformed tokens instead of rewriting the root", () => {
    for (const token of ["abc/../admin", "abc?x=1", "abc#hash", "abc def", "abc&type=signup", "abc%2e%2e", "", "a".repeat(2001)]) {
      assert.equal(safeRecoveryToken(token), null);
      assert.equal(sameHostRecoveryRedirect(rootUrl(`?token_hash=${encodeURIComponent(token)}&type=recovery`)), null);
    }
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

describe("recovery wiring", () => {
  it("rewrites the root before the login wall and does not send the browser to the app scheme", () => {
    const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
    const call = middleware.indexOf("sameHostRecoveryRedirect(request.nextUrl)");
    const login = middleware.indexOf('url.pathname = "/login"');
    const signedOut = middleware.indexOf("if (!user && !isLoginPage)");
    assert.ok(call > 0 && login > call && signedOut > call);
    assert.equal(middleware.slice(0, call).includes("supabase.auth.getUser"), false);
    assert.doesNotMatch(middleware, /xpressclient:/);
    assert.equal(existsSync(join(root, "src/app/auth/confirm/route.ts")), false);
    const bridge = readFileSync(join(root, "src/app/auth/reset/page.tsx"), "utf8");
    assert.doesNotMatch(bridge, /verifyOtp|exchangeCodeForSession/);
  });

  it("keeps Apple links on join paths and the staff reset page on its MFA step", () => {
    const aasa = readFileSync(join(root, "src/app/.well-known/apple-app-site-association/route.ts"), "utf8");
    const setPassword = readFileSync(join(root, "src/app/auth/set-password/page.tsx"), "utf8");
    assert.match(aasa, /\/j\/\*/);
    assert.doesNotMatch(aasa, /\/auth\//);
    assert.match(setPassword, /passwordChangeNeedsTotp/);
    assert.match(setPassword, /elevateSessionWithTotp/);
    assert.match(setPassword, /MfaPasswordStep/);
    assert.equal(existsSync(join(root, "docs/auth-recovery-email.md")), false);
    assert.equal(existsSync(join(root, "docs/auth-email-templates/reset-password.client.html")), false);
    assert.equal(existsSync(join(root, "docs/auth-email-templates/reset-password.staff-link-fix.html")), false);
  });
});
