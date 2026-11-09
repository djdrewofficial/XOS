import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindMessages, messagesMatch, sameIdSet } from "./jobApproval.ts";

describe("approved job delivery", () => {
  it("sends only when the recipient and body still match", () => {
    const fresh = [{ to: "Ada@Example.com", subject: "Morning", body: "<p>Hello</p>" }];
    const approved = bindMessages(fresh);
    assert.equal(messagesMatch(approved, fresh)[0].body, "<p>Hello</p>");
    assert.throws(() => messagesMatch(approved, [{ ...fresh[0], body: "<p>Different</p>" }]), /Nothing was sent/);
    assert.throws(() => sameIdSet(["b", "a"], ["a"]), /Nothing was changed/);
  });
});