import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyOneTimeLink, ONE_TIME_PLACEHOLDER } from "./oneTimeLink.ts";

const kind = "set-password" as const;
const placeholder = ONE_TIME_PLACEHOLDER[kind];
const frozen = `Hello ada@example.com. Set your password: ${placeholder}`;

const origins = { appOrigin: "https://xos.example", authOrigin: "https://db.example" };

function link(token: string, path = "/auth/set-password", host = "https://xos.example", auth = "https://db.example") {
  return `${auth}/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(`${host}${path}`)}`;
}

describe("one-time link approval", () => {
  it("allows a different token and keeps the host, path, and recovery purpose", () => {
    const first = applyOneTimeLink(frozen, link("token-one-aaaa"), kind, origins);
    const second = applyOneTimeLink(frozen, link("token-two-bbbb"), kind, origins);
    assert.equal(first.includes("token-one-aaaa"), true);
    assert.equal(second.includes("token-two-bbbb"), true);
    assert.equal(first.split("token-one-aaaa").join("TOKEN"), second.split("token-two-bbbb").join("TOKEN"));
    assert.equal(frozen.includes("token-one-aaaa"), false);
    assert.equal(first.includes(placeholder), false);
  });

  it("refuses a different redirect path or a missing placeholder", () => {
    assert.throws(() => applyOneTimeLink(frozen, link("token-one-aaaa", "/steal"), kind, origins), /set-password/);
    assert.throws(() => applyOneTimeLink(frozen, link("token-one-aaaa", "/auth/set-password", "https://evil.example"), kind, origins), /configured app host/);
    assert.throws(() => applyOneTimeLink(frozen, link("token-one-aaaa").replace("type=recovery", "type=magiclink"), kind, origins), /recovery/);
    assert.throws(() => applyOneTimeLink("no placeholder", link("token-one-aaaa"), kind, origins), /exactly once/);
    assert.throws(() => applyOneTimeLink(frozen, "http://evil.example/auth/v1/verify?token=token-one-aaaa&type=recovery&redirect_to=https%3A%2F%2Fxos.example%2Fauth%2Fset-password", kind, origins), /auth host|https/);
  });
});
