import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideIdempotency, idempotencyKeyError } from "./mcp/idempotency.ts";
import { classifyAgentSms, assertSmsBody } from "./mcp/smsPolicy.ts";
import { hideClientLinks } from "./mcp/redact.ts";

describe("idempotency decisions", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  it("rejects keys that the database check would reject", () => {
    assert.ok(idempotencyKeyError("pay-1"));
    assert.ok(idempotencyKeyError("note-9"));
    assert.equal(idempotencyKeyError("note-9-ok"), null);
  });

  it("lets only one owner through and does not replay a different call", () => {
    assert.equal(decideIdempotency({ existing: null, toolName: "payments_add", argsHash: "a", now, ttlMs: 1000 }).kind, "owned");
    const running = decideIdempotency({
      existing: { toolName: "payments_add", argsHash: "a", response: null, createdAt: new Date(now).toISOString(), status: "running" },
      toolName: "payments_add",
      argsHash: "a",
      now: now + 1000,
      ttlMs: 86_400_000,
    });
    assert.equal(running.kind, "in_progress");
    const mismatch = decideIdempotency({
      existing: { toolName: "payments_add", argsHash: "a", response: { ok: true }, createdAt: new Date(now).toISOString(), status: "completed" },
      toolName: "payments_add",
      argsHash: "b",
      now,
      ttlMs: 86_400_000,
    });
    assert.equal(mismatch.kind, "mismatch");
  });

  it("does not retry a running call that went quiet", () => {
    const decision = decideIdempotency({
      existing: { toolName: "payments_add", argsHash: "a", response: null, createdAt: new Date(now - 5 * 60_000).toISOString(), status: "running" },
      toolName: "payments_add",
      argsHash: "a",
      now,
      ttlMs: 86_400_000,
    });
    assert.equal(decision.kind, "uncertain");
  });
});

describe("agent sms classification", () => {
  it("treats a freeform body as marketing and keeps a template flag", () => {
    assert.equal(classifyAgentSms({ templateId: null, templateIsMarketing: false }).isMarketing, true);
    assert.equal(classifyAgentSms({ templateId: "tpl", templateIsMarketing: false }).isMarketing, false);
    assert.equal(classifyAgentSms({ templateId: "tpl", templateIsMarketing: true }).policy, "template_flag");
  });

  it("refuses to shorten a text instead of sending a different one", () => {
    assert.throws(() => assertSmsBody("x".repeat(1601)), /was not shortened/);
    assert.equal(assertSmsBody("hello"), "hello");
  });
});

describe("client link redaction", () => {
  it("hides signing and payment urls from agent output", () => {
    const hidden = hideClientLinks({
      body: "Sign at https://xos.xpressdjs.com/sign/abcDEF_123 and pay https://x.netlify.app/pay/tok-1",
      signing_url: "https://xos.xpressdjs.com/sign/abcDEF_123",
      note: "Investment is $4,550",
    }) as { body: string; signing_url: string; note: string };
    assert.equal(hidden.signing_url, "[client link]");
    assert.doesNotMatch(hidden.body, /\/sign\/|\/pay\//);
    assert.match(hidden.note, /4,550/);
  });
});
