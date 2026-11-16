import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateOnPaymentSkip,
  isPaypalPayment,
  isPaypalThankYouSubject,
  onPaymentSkipLogAction,
} from "./onPaymentHelperSkip.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(join(root, "supabase/migrations/00234_on_payment_helper_skips.sql"), "utf8");
const automations = readFileSync(join(root, "src/lib/automations.ts"), "utf8");
const paypalRecord = readFileSync(join(root, "src/lib/paypalRecord.ts"), "utf8");
const helperPage = readFileSync(join(root, "src/app/(app)/settings/helpers/[id]/page.tsx"), "utf8");
const helperActions = readFileSync(join(root, "src/app/(app)/settings/helpers/actions.ts"), "utf8");
const bookingHelperRun = readFileSync(join(root, "src/lib/bookingHelperRun.ts"), "utf8");

const paypalPayment = { id: "pay-1", method: "paypal", paypal_capture_id: "CAP-1" };
const zellePayment = { id: "pay-2", method: "zelle", paypal_capture_id: null };

describe("evaluateOnPaymentSkip", () => {
  it("skips hidden-financials events when the helper flag is on", () => {
    const r = evaluateOnPaymentSkip(
      { on_payment_skip_hidden_financials: true, on_payment_skip_paypal_thanked: true },
      { financialsHidden: true, payment: zellePayment, paypalThankYouLogged: false },
    );
    assert.equal(r.skip, true);
    assert.match(r.reason!, /hidden financials/i);
  });

  it("does not skip hidden financials when the helper flag is off", () => {
    const r = evaluateOnPaymentSkip(
      { on_payment_skip_hidden_financials: false, on_payment_skip_paypal_thanked: true },
      { financialsHidden: true, payment: zellePayment, paypalThankYouLogged: false },
    );
    assert.equal(r.skip, false);
  });

  it("skips PayPal payments that already got a thank-you when the flag is on", () => {
    const r = evaluateOnPaymentSkip(
      { on_payment_skip_hidden_financials: true, on_payment_skip_paypal_thanked: true },
      { financialsHidden: false, payment: paypalPayment, paypalThankYouLogged: true },
    );
    assert.equal(r.skip, true);
    assert.match(r.reason!, /PayPal thank-you/i);
  });

  it("still sends for PayPal when no thank-you was logged (e.g. no client email)", () => {
    const r = evaluateOnPaymentSkip(
      { on_payment_skip_hidden_financials: true, on_payment_skip_paypal_thanked: true },
      { financialsHidden: false, payment: paypalPayment, paypalThankYouLogged: false },
    );
    assert.equal(r.skip, false);
  });

  it("does not treat Zelle as a PayPal thank-you skip", () => {
    const r = evaluateOnPaymentSkip(
      { on_payment_skip_hidden_financials: false, on_payment_skip_paypal_thanked: true },
      { financialsHidden: false, payment: zellePayment, paypalThankYouLogged: true },
    );
    assert.equal(r.skip, false);
  });

  it("prefers the hidden-financials reason when both would skip", () => {
    const r = evaluateOnPaymentSkip(
      { on_payment_skip_hidden_financials: true, on_payment_skip_paypal_thanked: true },
      { financialsHidden: true, payment: paypalPayment, paypalThankYouLogged: true },
    );
    assert.match(r.reason!, /hidden financials/i);
  });
});

describe("PayPal helpers", () => {
  it("detects paypal method and capture id", () => {
    assert.equal(isPaypalPayment({ method: "PayPal", paypal_capture_id: null }), true);
    assert.equal(isPaypalPayment({ method: "zelle", paypal_capture_id: "CAP" }), true);
    assert.equal(isPaypalPayment({ method: "cash", paypal_capture_id: null }), false);
  });

  it("matches the automatic thank-you subject", () => {
    assert.equal(isPaypalThankYouSubject("Payment received — thank you, Sam!"), true);
    assert.equal(isPaypalThankYouSubject("Payment received for Wedding"), false);
  });

  it("formats an event log line without re-prefixing", () => {
    assert.equal(
      onPaymentSkipLogAction("Send Payment Received Receipt", "Skipped on-payment run: event has hidden financials"),
      "Booking helper skipped: Send Payment Received Receipt — event has hidden financials",
    );
  });
});

describe("migration 00234 on-payment helper skips", () => {
  it("adds the two helper columns, email_log.payment_id, and seeds the receipt helper ON", () => {
    assert.match(migration, /00234/);
    assert.match(migration, /on_payment_skip_hidden_financials/);
    assert.match(migration, /on_payment_skip_paypal_thanked/);
    assert.match(migration, /email_log[\s\S]*payment_id/);
    assert.match(migration, /a0248b63-b1f1-45d8-ba83-0dc210167f56/);
    assert.match(migration, /Send Payment Received Receipt/);
    assert.match(migration, /on_payment_skip_hidden_financials = true/);
    assert.match(migration, /on_payment_skip_paypal_thanked = true/);
    assert.match(migration, /Do NOT apply/i);
  });
});

describe("wiring: on-payment only, manual path untouched", () => {
  it("runAutomations evaluates skips and logs them; only payment_received uses them", () => {
    assert.match(automations, /evaluateOnPaymentSkip/);
    assert.match(automations, /onPaymentSkipLogAction/);
    assert.match(automations, /event_logs/);
    assert.match(automations, /paymentId/);
    assert.match(automations, /no backfill/i);
    assert.match(automations, /loadOnPaymentSkipContext/);
  });

  it("PayPal thank-you is linked to payment_id before automations run", () => {
    assert.match(paypalRecord, /payment_id: paymentId/);
    assert.match(paypalRecord, /Payment received — thank you/);
    assert.match(paypalRecord, /runAutomations\([\s\S]*paymentId/);
  });

  it("helper editor exposes both toggles and the save action persists them", () => {
    assert.match(helperPage, /on_payment_skip_hidden_financials/);
    assert.match(helperPage, /on_payment_skip_paypal_thanked/);
    assert.match(helperPage, /Skip events with hidden financials/);
    assert.match(helperPage, /Skip PayPal payments that already got a thank-you email/);
    assert.match(helperActions, /on_payment_skip_hidden_financials/);
    assert.match(helperActions, /on_payment_skip_paypal_thanked/);
  });

  it("manual executeBookingHelper does not import or call on-payment skip rules", () => {
    assert.doesNotMatch(bookingHelperRun, /onPaymentHelperSkip|evaluateOnPaymentSkip|on_payment_skip_/);
  });
});
