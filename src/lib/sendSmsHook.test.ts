import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { toE164 } from "./phone.ts";
import {
  createSendSmsGuards,
  handleSendSmsHook,
  hookSecretKeys,
  loginCodeSms,
  verifySendSmsSignature,
  type SendSmsFn,
  type SendSmsGuards,
} from "./sendSmsHook.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const key = Buffer.from("xos-send-sms-hook-test-key");
const secretB64 = key.toString("base64");
const secret = `v1,whsec_${secretB64}`;
const otp = "123456";
const phone = "+13055550199";
const nowSec = 1_700_000_000;
const nowMs = nowSec * 1000;

function payload(code = otp, to = phone, smsPhone?: string) {
  return JSON.stringify({
    user: { phone: to },
    sms: smsPhone ? { otp: code, phone: smsPhone } : { otp: code },
  });
}

function sign(body: string, id = "msg_01", timestamp = String(nowSec), hmacKey: Buffer = key) {
  return createHmac("sha256", hmacKey).update(`${id}.${timestamp}.${body}`).digest("base64");
}

function request(opts: {
  body?: string;
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
  method?: string;
}) {
  const body = opts.body ?? payload();
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.id !== null) headers.set("webhook-id", opts.id ?? "msg_01");
  if (opts.timestamp !== null) headers.set("webhook-timestamp", opts.timestamp ?? String(nowSec));
  if (opts.signature !== null) {
    headers.set("webhook-signature", opts.signature ?? `v1,${sign(body, opts.id ?? "msg_01", opts.timestamp ?? String(nowSec))}`);
  }
  return new Request("https://xos.xpressdjs.com/api/auth/hooks/send-sms", {
    method: opts.method ?? "POST",
    headers,
    body: opts.method === "GET" ? undefined : body,
  });
}

function harness(sendSms: SendSmsFn, guards: SendSmsGuards = createSendSmsGuards()) {
  const logs: { message: string; fields?: Record<string, string> }[] = [];
  const sent: { phone: string; body: string }[] = [];
  const wrapped: SendSmsFn = async (opts) => {
    sent.push(opts);
    return sendSms(opts);
  };
  return {
    sent,
    logs,
    guards,
    handle: (req: Request, overrideSecret: string | null = secret) =>
      handleSendSmsHook(req, {
        sendSms: wrapped,
        normalizePhone: toE164,
        secret: overrideSecret,
        now: () => nowMs,
        guards,
        log: (message, fields) => logs.push({ message, fields }),
      }),
  };
}

describe("login code copy", () => {
  it("reads like a person and states the 10 minute expiry", () => {
    assert.equal(loginCodeSms("654321"), "Your Xpress code is 654321. It expires in 10 minutes.");
  });
});

describe("hook secret and signature", () => {
  it("accepts the dashboard v1,whsec_ secret and a bare whsec_ secret", () => {
    assert.equal(hookSecretKeys(secret).length, 1);
    assert.equal(hookSecretKeys(`whsec_${secretB64}`).length, 1);
    assert.deepEqual(hookSecretKeys(secret)[0], key);
    assert.equal(hookSecretKeys("").length, 0);
    assert.equal(hookSecretKeys("not a secret").length, 0);
  });

  it("accepts a current signature and rejects tampering, skew, and the wrong key", () => {
    const body = payload();
    const ok = verifySendSmsSignature({
      secret,
      id: "msg_01",
      timestamp: String(nowSec),
      signature: `v1,${sign(body)}`,
      body,
      nowSec,
    });
    assert.equal(ok.ok, true);

    const tampered = verifySendSmsSignature({
      secret,
      id: "msg_01",
      timestamp: String(nowSec),
      signature: `v1,${sign(body)}`,
      body: payload("654321"),
      nowSec,
    });
    assert.equal(tampered.ok, false);

    const stale = verifySendSmsSignature({
      secret,
      id: "msg_01",
      timestamp: String(nowSec - 301),
      signature: `v1,${sign(body, "msg_01", String(nowSec - 301))}`,
      body,
      nowSec,
    });
    assert.equal(stale.ok, false);

    const wrong = verifySendSmsSignature({
      secret: "v1,whsec_" + Buffer.from("other-key").toString("base64"),
      id: "msg_01",
      timestamp: String(nowSec),
      signature: `v1,${sign(body)}`,
      body,
      nowSec,
    });
    assert.equal(wrong.ok, false);
    assert.equal(
      verifySendSmsSignature({ secret, id: null, timestamp: null, signature: null, body, nowSec }).reason,
      "missing-headers",
    );
  });

  it("matches the published Standard Webhooks test vector", () => {
    const body = '{"test": 2432232314}';
    const vectorSecret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const check = verifySendSmsSignature({
      secret: `v1,${vectorSecret}`,
      id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
      timestamp: "1614265330",
      signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
      body,
      nowSec: 1614265330,
    });
    assert.equal(check.ok, true);
  });

  it("accepts the second signature when GoTrue joins them with a comma", () => {
    const body = payload();
    const other = Buffer.from("rotated-out-key");
    const header = `v1,${sign(body, "msg_01", String(nowSec), other)}, v1,${sign(body)}`;
    const bothSecrets = `${secret},v1,whsec_${other.toString("base64")}`;
    const check = verifySendSmsSignature({
      secret: bothSecrets,
      id: "msg_01",
      timestamp: String(nowSec),
      signature: header,
      body,
      nowSec,
    });
    assert.equal(check.ok, true);
  });
});

describe("handleSendSmsHook", () => {
  it("sends the code through the injected HighLevel sender and returns an empty object", async () => {
    const h = harness(async () => ({ ok: true, messageId: "hl_1" }));
    const res = await h.handle(request({}));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.deepEqual(await res.json(), {});
    assert.deepEqual(h.sent, [
      { phone, body: "Your Xpress code is 123456. It expires in 10 minutes." },
    ]);
    assert.equal(h.logs.length, 0);
  });

  it("uses sms.phone when the user object has no phone", async () => {
    const h = harness(async () => ({ ok: true, messageId: null }));
    const body = JSON.stringify({ sms: { otp, phone } });
    const res = await h.handle(request({ body, signature: `v1,${sign(body)}` }));
    assert.equal(res.status, 200);
    assert.equal(h.sent[0]?.phone, phone);
  });

  it("normalizes a dashed US number before the send", async () => {
    const h = harness(async () => ({ ok: true, messageId: null }));
    const body = payload(otp, "305-555-0199");
    const res = await h.handle(request({ body, signature: `v1,${sign(body)}` }));
    assert.equal(res.status, 200);
    assert.equal(h.sent[0]?.phone, "+13055550199");
  });

  it("surfaces a HighLevel failure without the code in the response or the log", async () => {
    const text = loginCodeSms(otp);
    const h = harness(async () => ({
      ok: false,
      error: `DND is active for SMS. message=${text}`,
    }));
    const res = await h.handle(request({}));
    const raw = await res.text();
    assert.equal(res.status, 200);
    assert.equal(raw.includes(otp), false);
    const body = JSON.parse(raw) as { error: { http_code: number; message: string } };
    assert.equal(body.error.http_code, 500);
    assert.match(body.error.message, /DND is active for SMS/);
    assert.equal(JSON.stringify(h.logs).includes(otp), false);
    assert.match(h.logs[0]?.fields?.reason ?? "", /DND is active for SMS/);
  });

  it("tells Drew when HighLevel or the hook secret is missing", async () => {
    const missingHl = harness(async () => ({ ok: false, error: "HighLevel not configured" }));
    const hl = await missingHl.handle(request({}));
    assert.deepEqual(await hl.json(), {
      error: { http_code: 500, message: "HighLevel is not configured." },
    });

    const missingSecret = harness(async () => ({ ok: true, messageId: null }));
    const sec = await missingSecret.handle(request({}), "");
    assert.equal(sec.status, 200);
    assert.match((await sec.json()).error.message, /SEND_SMS_HOOK_SECRET/);
    assert.equal(missingSecret.sent.length, 0);
  });

  it("refuses a bad signature and does not send", async () => {
    const h = harness(async () => ({ ok: true, messageId: null }));
    const res = await h.handle(request({ signature: "v1,bm90LXRoZS1zaWduYXR1cmU=" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.error.http_code, 401);
    assert.equal(body.error.message.includes(otp), false);
    assert.equal(h.sent.length, 0);
  });

  it("answers HTTP 401 when the webhook headers are missing", async () => {
    const h = harness(async () => ({ ok: true, messageId: null }));
    const res = await h.handle(request({ id: null, timestamp: null, signature: null }));
    assert.equal(res.status, 401);
    assert.equal(h.sent.length, 0);
  });

  it("rejects a code that is not 6 digits and a phone it cannot text", async () => {
    const h = harness(async () => ({ ok: true, messageId: null }));
    const badCode = payload("12345");
    const codeRes = await h.handle(request({ body: badCode, signature: `v1,${sign(badCode)}` }));
    assert.equal((await codeRes.json()).error.http_code, 400);

    const badPhone = payload(otp, "555");
    const phoneRes = await h.handle(
      request({ body: badPhone, id: "msg_02", signature: `v1,${sign(badPhone, "msg_02")}` }),
    );
    assert.match((await phoneRes.json()).error.message, /phone/i);
    assert.equal(h.sent.length, 0);
  });

  it("does not send the same code twice and rate limits the number", async () => {
    const h = harness(async () => ({ ok: true, messageId: "hl_1" }));
    const first = await h.handle(request({}));
    assert.equal(first.status, 200);
    const replay = await h.handle(request({ id: "msg_01_retry" }));
    assert.deepEqual(await replay.json(), {});
    assert.equal(h.sent.length, 1);

    for (let i = 0; i < 7; i++) {
      const code = String(200000 + i);
      const body = payload(code);
      const id = `msg_more_${i}`;
      const res = await h.handle(request({ body, id, signature: `v1,${sign(body, id)}` }));
      assert.equal(res.status, 200);
    }
    const blockedBody = payload("299999");
    const blocked = await h.handle(
      request({
        body: blockedBody,
        id: "msg_blocked",
        signature: `v1,${sign(blockedBody, "msg_blocked")}`,
      }),
    );
    const blockedJson = await blocked.json();
    assert.equal(blockedJson.error.http_code, 429);
    assert.match(blockedJson.error.message, /Too many login codes/);
    assert.equal(blockedJson.error.message.includes("299999"), false);
    assert.equal(h.sent.length, 8);
  });

  it("texts the MFA factor number when it differs from the login phone", async () => {
    const h = harness(async () => ({ ok: true, messageId: "hl_mfa" }));
    const factor = "+13055550100";
    const body = payload(otp, phone, factor);
    const res = await h.handle(request({ body, id: "msg_factor", signature: `v1,${sign(body, "msg_factor")}` }));
    assert.equal(res.status, 200);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0]?.phone, factor);
    assert.equal(h.sent[0]?.body.includes(otp), true);
  });

  it("does not fall back to the login phone when the factor number is unusable", async () => {
    const h = harness(async () => ({ ok: true, messageId: "hl_bad" }));
    const body = payload(otp, phone, "555");
    const res = await h.handle(request({ body, id: "msg_bad_factor", signature: `v1,${sign(body, "msg_bad_factor")}` }));
    assert.equal(res.status, 200);
    assert.match((await res.json()).error.message, /phone/i);
    assert.equal(h.sent.length, 0);
  });

  it("does not throw the code into a log when the sender throws", async () => {
    const h = harness(async () => {
      throw new Error(`provider blew up with ${otp}`);
    });
    const res = await h.handle(request({}));
    const raw = JSON.stringify(await res.json()) + JSON.stringify(h.logs);
    assert.equal(raw.includes(otp), false);
    assert.match(h.logs[0]?.message ?? "", /threw/);
  });
});

describe("wiring", () => {
  it("exempts only the send-sms path and sends through HighLevel", () => {
    const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
    const route = readFileSync(join(root, "src/app/api/auth/hooks/send-sms/route.ts"), "utf8");
    assert.equal(middleware.split("isAuthSendSmsHook(").length - 1, 3);
    assert.match(middleware, /pathname === "\/api\/auth\/hooks\/send-sms"/);
    assert.doesNotMatch(middleware, /startsWith\("\/api\/auth/);
    assert.match(route, /sendDirectSms/);
    assert.match(route, /SEND_SMS_HOOK_SECRET/);
    assert.match(route, /toE164/);
    assert.match(route, /handleSendSmsHook/);
  });
});
