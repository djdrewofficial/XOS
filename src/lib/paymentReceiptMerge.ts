/* Payment-received receipt merge tags — TypeScript mirror of the SQL resolver
   in migration 00226 (most_recent_payment_*, balance_status). Keep the money
   rules identical: only approved, non-deleted payment.amount reduces the
   balance; processing_fee is shown separately and never counted as paid. */

export type ReceiptPayment = {
  amount: number;
  method: string;
  paidAt: string; // ISO date or timestamptz
  processingFee?: number | null;
  notes?: string | null;
  bankDepositRef?: string | null;
  status?: string | null;
  deletedAt?: string | null;
};

export type ReceiptEventMoney = {
  totalFee: number;
  payments: ReceiptPayment[];
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const longDate = (iso: string) => {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

/** Display label for a stored payment method (PayPal stays PayPal). */
export function formatPaymentMethod(method: string): string {
  const raw = (method ?? "").trim();
  if (!raw) return "";
  if (/[A-Z]/.test(raw)) return raw;
  const key = raw.toLowerCase();
  const known: Record<string, string> = {
    paypal: "PayPal",
    card: "Card",
    cash: "Cash",
    check: "Check",
    zelle: "Zelle",
    venmo: "Venmo",
    ach: "ACH",
    other: "Other",
  };
  if (known[key]) return known[key];
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function livePayments(payments: ReceiptPayment[]): ReceiptPayment[] {
  return payments.filter((p) => (p.status ?? "approved") === "approved" && !p.deletedAt);
}

/** Most recent live payment — paid_at desc, then list order as a stable tiebreak. */
export function mostRecentPayment(payments: ReceiptPayment[]): ReceiptPayment | null {
  const live = livePayments(payments);
  if (live.length === 0) return null;
  return [...live].sort((a, b) => {
    const ta = new Date(a.paidAt).getTime();
    const tb = new Date(b.paidAt).getTime();
    return tb - ta;
  })[0] ?? null;
}

export function totalPaid(payments: ReceiptPayment[]): number {
  return Math.round(livePayments(payments).reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100;
}

export function balanceDue(totalFee: number, payments: ReceiptPayment[]): number {
  return Math.round((Number(totalFee) - totalPaid(payments)) * 100) / 100;
}

/** "Paid in full" when nothing remains; otherwise a money string. */
export function balanceStatus(totalFee: number, payments: ReceiptPayment[]): string {
  const bal = balanceDue(totalFee, payments);
  return bal <= 0 ? "Paid in full" : money(bal);
}

export type PaymentReceiptTags = {
  most_recent_payment_amount: string;
  most_recent_payment_method: string;
  most_recent_payment_date: string;
  most_recent_payment_processing_fee: string;
  most_recent_payment_fee_line: string;
  most_recent_payment_notes: string;
  payments_received: string;
  balance_due: string;
  balance_status: string;
};

/** Notes on the payment, falling back to bank deposit reference. */
export function paymentNotes(payment: ReceiptPayment | null): string {
  if (!payment) return "";
  const notes = (payment.notes ?? "").trim();
  if (notes) return notes;
  return (payment.bankDepositRef ?? "").trim();
}

export function paymentReceiptTags(input: ReceiptEventMoney): PaymentReceiptTags {
  const paid = totalPaid(input.payments);
  const bal = balanceDue(input.totalFee, input.payments);
  const latest = mostRecentPayment(input.payments);
  const fee = latest ? Number(latest.processingFee ?? 0) : 0;
  const feeMoney = fee > 0 ? money(fee) : "";
  return {
    most_recent_payment_amount: latest ? money(Number(latest.amount || 0)) : "",
    most_recent_payment_method: latest ? formatPaymentMethod(latest.method) : "",
    most_recent_payment_date: latest ? longDate(latest.paidAt) : "",
    most_recent_payment_processing_fee: feeMoney,
    most_recent_payment_fee_line:
      fee > 0 ? `<br>Card service fee: <strong>${feeMoney}</strong>` : "",
    most_recent_payment_notes: paymentNotes(latest),
    payments_received: money(paid),
    balance_due: money(bal),
    balance_status: bal <= 0 ? "Paid in full" : money(bal),
  };
}

/** Sanitize a rendered pdf_filename template into a safe .pdf basename. */
export function receiptPdfFilename(rendered: string | null | undefined, fallback = "Xpress Receipt"): string {
  const base = (rendered ?? "")
    .replace(/<[^>]+>/g, "") // leftover unmerged tags
    .replace(/[^\w\- &']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || fallback}.pdf`;
}

/** Seeded Payment Receipt document body (HTML with merge tags). Editable in Documents. */
export const PAYMENT_RECEIPT_DOC_BODY = [
  "<p>Thank you for your payment. This receipt relates to your booking agreement with Xpress Entertainment.</p>",
  "<p><strong>Client:</strong> <client_name><br>",
  "<strong>Event:</strong> <event_name><br>",
  "<strong>Event number:</strong> <event_number><br>",
  "<strong>Event date:</strong> <event_date_long></p>",
  "<p><strong>Payment received</strong><br>",
  "Amount: <strong><most_recent_payment_amount></strong><br>",
  "Method: <strong><most_recent_payment_method></strong><br>",
  "Date: <strong><most_recent_payment_date></strong>",
  "<most_recent_payment_fee_line></p>",
  "<p>Confirmation / notes: <most_recent_payment_notes></p>",
  "<p>Investment total: <strong><total_fee></strong><br>",
  "Paid to date: <strong><payments_received></strong><br>",
  "Remaining balance: <strong><balance_status></strong></p>",
  "<p>If anything looks off, reply to this email and we will sort it out.</p>",
].join("\n");

export const PAYMENT_RECEIPT_PDF_FILENAME = "Xpress Receipt - <event_number>";
export const PAYMENT_RECEIPT_TEMPLATE_ID = "c8e4f1a2-9b3d-4e5f-a6c7-d8e9f0a1b228";

/** English Payment Received body (same copy seeded in migration 00226). */
export const PAYMENT_RECEIVED_SUBJECT =
  "Payment received for <event_name>";

export const PAYMENT_RECEIVED_BODY = [
  "<p>Hi <first_name>,</p>",
  "<p>Thank you! We received your payment for <event_name> on <event_date_long>.</p>",
  "<p><strong>This payment</strong><br>",
  "Amount: <strong><most_recent_payment_amount></strong><br>",
  "Method: <strong><most_recent_payment_method></strong><br>",
  "Date: <strong><most_recent_payment_date></strong>",
  "<most_recent_payment_fee_line></p>",
  "<p>Total paid so far: <strong><payments_received></strong><br>",
  "Remaining balance: <strong><balance_status></strong></p>",
  "<p>This is your receipt for your records. It relates to your booking agreement with us. If anything looks off, just reply to this email and we will sort it out.</p>",
  "<p>With gratitude,<br>The Xpress Entertainment Team</p>",
].join("");

/** Fill &lt;tag&gt; placeholders from a flat map (order does not matter). */
export function applyMergeTags(template: string, tags: Record<string, string>): string {
  let out = template.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  for (const [key, value] of Object.entries(tags)) {
    out = out.split(`<${key}>`).join(value ?? "");
  }
  return out;
}
