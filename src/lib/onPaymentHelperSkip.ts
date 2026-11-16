/** Skip rules for booking helpers that fire on the payment_received automation.
    Manual Send Payment Receipt / helper button runs do NOT use these — only
    runAutomations(…, "payment_received"). */

export const PAYPAL_THANK_YOU_SUBJECT_RE = /^Payment received — thank you/i;

export type OnPaymentSkipFlags = {
  on_payment_skip_hidden_financials?: boolean | null;
  on_payment_skip_paypal_thanked?: boolean | null;
};

export type OnPaymentSkipContext = {
  financialsHidden: boolean;
  payment: {
    id: string;
    method: string | null;
    paypal_capture_id?: string | null;
  } | null;
  /** True when email_log has a PayPal thank-you linked to this payment (or a
      reliable same-event fallback match for this payment). */
  paypalThankYouLogged: boolean;
};

export type OnPaymentSkipResult = {
  skip: boolean;
  reason: string | null;
};

export function isPaypalPayment(payment: { method: string | null; paypal_capture_id?: string | null } | null): boolean {
  if (!payment) return false;
  if (payment.paypal_capture_id) return true;
  return (payment.method ?? "").trim().toLowerCase() === "paypal";
}

export function isPaypalThankYouSubject(subject: string | null | undefined): boolean {
  return PAYPAL_THANK_YOU_SUBJECT_RE.test((subject ?? "").trim());
}

/** Pure skip decision for one helper + one payment. First matching rule wins. */
export function evaluateOnPaymentSkip(
  helper: OnPaymentSkipFlags,
  ctx: OnPaymentSkipContext,
): OnPaymentSkipResult {
  if (helper.on_payment_skip_hidden_financials && ctx.financialsHidden) {
    return {
      skip: true,
      reason: "Skipped on-payment run: event has hidden financials",
    };
  }
  if (helper.on_payment_skip_paypal_thanked && isPaypalPayment(ctx.payment) && ctx.paypalThankYouLogged) {
    return {
      skip: true,
      reason: "Skipped on-payment run: PayPal thank-you email already sent for this payment",
    };
  }
  return { skip: false, reason: null };
}

/** Format the event log line office staff see when an auto run is skipped. */
export function onPaymentSkipLogAction(helperTitle: string, reason: string): string {
  return `Booking helper skipped: ${helperTitle} — ${reason.replace(/^Skipped on-payment run:\s*/i, "")}`;
}
