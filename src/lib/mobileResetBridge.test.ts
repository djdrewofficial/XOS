import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MOBILE_RESET_REDIRECT,
  mobileResetResponseHeaders,
  mobileResetView,
  sameHostRecoveryRedirect,
} from "./passwordResetPath.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function query(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

describe("mobile reset bridge", () => {
  it("builds only the fixed app link for a valid token", () => {
    const view = mobileResetView(query("token_hash=fixtureToken_123&type=recovery"));
    assert.equal(view.state, "ready");
    if (view.state !== "ready") return;
    assert.equal(view.href, `${MOBILE_RESET_REDIRECT}?token_hash=fixtureToken_123&type=recovery`);
    assert.equal(view.href.startsWith("xpressclient://auth/reset?"), true);
  });

  it("drops extra parameters and never forwards an implicit token", () => {
    const view = mobileResetView(
      query(
        "token_hash=fixtureToken_123&type=recovery&next=https://evil.example/phish&redirect_to=https://evil.example&access_token=nope&refresh_token=nope&code=nope",
      ),
    );
    assert.equal(view.state, "ready");
    if (view.state !== "ready") return;
    assert.equal(view.href, `${MOBILE_RESET_REDIRECT}?token_hash=fixtureToken_123&type=recovery`);
    assert.equal(view.href.includes("evil.example"), false);
    assert.equal(view.href.includes("access_token"), false);
    assert.equal(view.href.includes("refresh_token"), false);
    assert.equal(view.href.includes("code="), false);
  });

  it("rejects missing, malformed, and unexpected values", () => {
    assert.equal(mobileResetView(query("")).state, "missing");
    assert.equal(mobileResetView(query("type=recovery")).state, "missing");
    assert.equal(mobileResetView(query("token_hash=fixtureToken_123")).state, "missing");
    assert.equal(mobileResetView(query("token_hash=abc/../admin&type=recovery")).state, "invalid");
    assert.equal(mobileResetView(query("token_hash=abc%2f..%2fadmin&type=recovery")).state, "invalid");
    assert.equal(mobileResetView(query("token_hash=abc%20def&type=recovery")).state, "invalid");
    assert.equal(mobileResetView(query("token_hash=fixtureToken_123&type=signup")).state, "invalid");
    assert.equal(mobileResetView(query("token_hash=one&token_hash=two&type=recovery")).state, "invalid");
    assert.equal(mobileResetView(query("token_hash=fixtureToken_123&type=recovery&type=signup")).state, "invalid");
    assert.equal(mobileResetView(query("access_token=aaa&refresh_token=bbb&type=recovery")).state, "missing");
    assert.equal(mobileResetView(query("error=access_denied&error_code=otp_expired&token_hash=fixtureToken_123&type=recovery")).state, "expired");
  });

  it("does not let the bridge replace the staff root fallback", () => {
    const bridge = new URL("https://xos.xpressdjs.com/auth/reset?token_hash=fixtureToken_123&type=recovery");
    assert.equal(sameHostRecoveryRedirect(bridge), null);
    const root = sameHostRecoveryRedirect(new URL("https://xos.xpressdjs.com/?token_hash=fixtureToken_123&type=recovery&next=https://evil.example"));
    assert.equal(root?.pathname, "/auth/set-password");
    assert.equal(root?.searchParams.get("token_hash"), "fixtureToken_123");
    assert.equal(root?.searchParams.get("next"), null);
  });
});

describe("mobile reset page stays public and staff reset stays put", () => {
  it("sets no-store headers before the login wall and does not verify on GET", () => {
    const middleware = read("src/middleware.ts");
    const page = read("src/app/auth/reset/page.tsx");
    const headersAt = middleware.indexOf('pathname === "/auth/reset"');
    const loginAt = middleware.indexOf('url.pathname = "/login"');
    assert.ok(headersAt > 0 && loginAt > headersAt);
    assert.match(middleware, /mobileResetResponseHeaders\(\)/);
    assert.match(middleware, /pathname\.startsWith\("\/auth\/"\)/);
    assert.equal(mobileResetResponseHeaders()["Cache-Control"], "private, no-store");
    assert.equal(mobileResetResponseHeaders()["Referrer-Policy"], "no-referrer");
    assert.match(mobileResetResponseHeaders()["X-Robots-Tag"], /noindex/);
    assert.match(page, /mobileResetView/);
    assert.doesNotMatch(page, /use client/);
    assert.doesNotMatch(page, /verifyOtp|exchangeCodeForSession|createClient|supabase/);
    assert.match(page, /Open Xpress DJs/);
    assert.match(page, /rel="noreferrer"/);
    assert.doesNotMatch(page, /fonts\.googleapis|xpressdjs\.com\/images|gtag|clarity|posthog/);
  });

  it("keeps staff MFA and join-only Apple links", () => {
    const setPassword = read("src/app/auth/set-password/page.tsx");
    const aasa = read("src/app/.well-known/apple-app-site-association/route.ts");
    assert.match(setPassword, /passwordChangeNeedsTotp/);
    assert.match(setPassword, /elevateSessionWithTotp/);
    assert.match(setPassword, /MfaPasswordStep/);
    assert.match(aasa, /\/j\/\*/);
    assert.doesNotMatch(aasa, /\/auth\//);
  });

  it("renders the branded template with Go for mobile and staff", () => {
    const out = execFileSync("go", ["test", "."], {
      cwd: join(root, "docs/auth-email-templates"),
      encoding: "utf8",
    });
    assert.match(out, /ok/);
  });
});
