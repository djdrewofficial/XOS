#!/usr/bin/env node
/**
 * Generate docs/samples/payment-receipt-sample.pdf (and copy to /opt/cursor/artifacts)
 * using the branded document shell + sample merge values. Does not touch the DB or send mail.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

await import("./register-ts-ext.mjs");

const { wrapDocHtml } = await import(pathToFileURL(join(root, "src/lib/documentHtml.ts")).href);
const {
  PAYMENT_RECEIPT_DOC_BODY,
  applyMergeTags,
  paymentReceiptTags,
  formatPaymentMethod,
} = await import(pathToFileURL(join(root, "src/lib/paymentReceiptMerge.ts")).href);
const { formatCurrentDateNy, formatPaymentDate } = await import(
  pathToFileURL(join(root, "src/lib/paymentDateFormat.ts")).href
);
const { htmlToPdf } = await import(pathToFileURL(join(root, "src/lib/pdf.ts")).href);
const { money } = await import(pathToFileURL(join(root, "src/lib/types.ts")).href);

const payments = [
  { amount: 200, method: "zelle", paidAt: "2026-10-14T00:00:00+00:00", processingFee: 0, reason: "Retainer" },
  {
    amount: 1050,
    method: "paypal",
    paidAt: "2026-11-12T18:30:00Z",
    processingFee: 42,
    notes: "PayPal capture CAP-SAMPLE-42",
  },
];

const tags = paymentReceiptTags({ totalFee: 1250, payments });

const rows = payments
  .map((p) => {
    const fee = Number(p.processingFee ?? 0);
    const feeLine =
      fee > 0 ? `<div class="xdoc-desc">Card service fee: ${money(fee)} (not applied to balance)</div>` : "";
    const note = p.notes || p.reason || "";
    return `<tr><td>${formatPaymentDate(p.paidAt)}</td><td>${formatPaymentMethod(p.method)}${feeLine}</td><td>${note}</td><td class="xdoc-amount">${money(p.amount)}</td></tr>`;
  })
  .join("");

const paymentsTable = `<table class="xdoc-table"><thead><tr><th>Paid</th><th>Method</th><th>Notes</th><th class="xdoc-amount">Amount</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3">Paid to date</td><td class="xdoc-amount">${tags.payments_received}</td></tr><tr><td colspan="3">Remaining balance</td><td class="xdoc-amount">${tags.balance_status}</td></tr></tfoot></table>`;

const body = applyMergeTags(PAYMENT_RECEIPT_DOC_BODY, {
  client_name: "Margie Weidman",
  event_name: "Weidman Wedding",
  event_number: "500123",
  event_date_long: "Saturday, August 15, 2026",
  current_date: formatCurrentDateNy(new Date("2026-11-16T17:00:00Z")),
  total_fee: "$1,250.00",
  ...tags,
});

const html = wrapDocHtml({
  companyName: "Xpress Entertainment",
  kicker: "Payment Receipt",
  title: "Payment Receipt - Margie Weidman",
  sub: "Margie Weidman · August 15, 2026",
  signedLine: "drew@xpressdjs.com",
  blocks: [{ html: body }, { html: paymentsTable }],
});

if (!process.env.CHROME_PATH) {
  for (const candidate of [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/local/bin/google-chrome",
  ]) {
    if (existsSync(candidate)) {
      process.env.CHROME_PATH = candidate;
      break;
    }
  }
}

const pdf = await htmlToPdf(html);
const outDir = join(root, "docs/samples");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "payment-receipt-sample.pdf");
writeFileSync(outFile, pdf);
console.log(`Wrote ${outFile} (${pdf.length} bytes)`);

const artifactDir = "/opt/cursor/artifacts";
try {
  mkdirSync(artifactDir, { recursive: true });
  const artifact = join(artifactDir, "payment-receipt-sample.pdf");
  copyFileSync(outFile, artifact);
  console.log(`Copied ${artifact}`);
} catch (err) {
  console.warn(`Could not copy to artifacts: ${err?.message ?? err}`);
}
