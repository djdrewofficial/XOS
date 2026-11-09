import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyOneTimeLink, ONE_TIME_PLACEHOLDER } from "./oneTimeLink.ts";

const kind = "set-password" as const;
const placeholder = ONE_TIME_PLACEHOLDER[kind];
const frozen = `Hello ada@example.com. Set your password: ${placeholder}`;

function link(token: string, path = "/auth/set-password") {
  return `https://db.example/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(`https://xos.example${path}`)}`;
}

describe("one-time link approval", () => {
  it("allows a different token and keeps the host, path, and recovery purpose", () => {
    const first = applyOneTimeLink(frozen, link("token-one-aaaa"), kind);
    const second = applyOneTimeLink(frozen, link("token-two-bbbb"), kind);
    assert.equal(first.includes("token-one-aaaa"), true);
    assert.equal(second.includes("token-two-bbbb"), true);
    assert.equal(first.split("token-one-aaaa").join("TOKEN"), second.split("token-two-bbbb").join("TOKEN"));
    assert.equal(frozen.includes("token-one-aaaa"), false);
    assert.equal(first.includes(placeholder), false);
  });

  it("refuses a different redirect path or a missing placeholder", () => {
    assert.throws(() => applyOneTimeLink(frozen, link("token-one-aaaa", "/steal"), kind), /set-password/);
    assert.throws(() => applyOneTimeLink("no placeholder", link("token-one-aaaa"), kind), /exactly once/);
    assert.throws(() => applyOneTimeLink(frozen, "https://evil.example/phish", kind), /recovery|redirect|token/);
  });
});
