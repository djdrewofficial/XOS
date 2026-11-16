#!/usr/bin/env node
/**
 * Generate docs/samples/payment-receipt-invoice-style.pdf from fake data.
 * Includes both a paid-in-full scenario and a balance-due scenario.
 * Does not touch the DB, send mail, or apply migrations.
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

await import("./register-ts-ext.mjs");

const { wrapDocHtml } = await import(pathToFileURL(join(root, "src/lib/documentHtml.ts")).href);
const {
  renderFeeTable,
  renderPaymentSchedule,
  renderPaymentsReceived,
  renderSummaryBox,
} = await import(pathToFileURL(join(root, "src/lib/documentRender.ts")).href);
const { formatCurrentDateNy } = await import(pathToFileURL(join(root, "src/lib/paymentDateFormat.ts")).href);
const { htmlToPdf } = await import(pathToFileURL(join(root, "src/lib/pdf.ts")).href);

function baseBundle(payments, total) {
  return {
    event: {
      id: "sample",
      name: "Weidman Wedding",
      event_date: "2026-08-15",
      setup_time: "16:00",
      start_time: "18:00",
      end_time: "23:00",
      guest_count: 150,
      package_id: "pkg",
      package_price_override: null,
      package_price_locked: 2450,
      package_version_no: 1,
      overtime_fee: 0,
      travel_fee: 150,
      discount1_label: "Early booking",
      discount1_amount: 100,
      discount2_label: null,
      discount2_amount: 0,
      client: { first_name: "Margie", last_name: "Weidman", email: "margie@example.com" },
      venue: {
        name: "Garden Estate",
        address: "100 Palm Ave",
        city: "Miami",
        state: "FL",
        setup_fee: 0,
      },
      package: {
        name: "The Xperience",
        client_facing_name: "The Xperience Package",
        default_price: 2450,
        description: "Full-service DJ entertainment",
      },
      event_type: { name: "Wedding" },
    },
    addons: [
      {
        quantity: 1,
        price_override: null,
        price_locked: 2100,
        description_override: null,
        addon: {
          name: "LED Dance Floor",
          client_facing_name: "LED Dance Floor",
          description: "16x16 interactive LED floor",
          default_price: 2100,
        },
      },
      {
        quantity: 8,
        price_override: null,
        price_locked: 25,
        addon: {
          name: "Uplighting",
          client_facing_name: "LED Uplighting",
          description: "Wireless LED cans",
          default_price: 25,
        },
      },
    ],
    schedule: [
      { id: "sp1", seq: 1, due_date: "2026-01-15", amount: 1000, label: "Retainer" },
      { id: "sp2", seq: 2, due_date: "2026-05-01", amount: 1800, label: "Second Payment" },
      { id: "sp3", seq: 3, due_date: "2026-08-01", amount: 1800, label: "Final Payment" },
    ],
    payments,
    pinnedDescription: "Full-service DJ entertainment",
    financialsHidden: false,
    contractNotes: [],
    total,
  };
}

const total = 2450 + 2100 + 8 * 25 + 150 - 100; // 4800

const paidInFullPayments = [
  { amount: 1000, method: "zelle", paidAt: "2026-01-15T00:00:00Z", reason: "Retainer", scheduledPaymentId: "sp1" },
  { amount: 1800, method: "check", paidAt: "2026-05-01T00:00:00Z", scheduledPaymentId: "sp2" },
  {
    amount: 2000,
    method: "paypal",
    paidAt: "2026-07-12T18:30:00Z",
    processingFee: 60,
    notes: "PayPal capture CAP-SAMPLE-99",
    scheduledPaymentId: "sp3",
  },
];

const balancePayments = [
  { amount: 1000, method: "zelle", paidAt: "2026-01-15T00:00:00Z", reason: "Retainer", scheduledPaymentId: "sp1" },
  { amount: 1800, method: "check", paidAt: "2026-05-01T00:00:00Z", notes: "Thanks!", scheduledPaymentId: "sp2" },
];

const feeOpts = { showDescriptions: true, showQty: true, totalLabel: "Total Investment" };
const payOpts = { showNotes: false };
const summaryOpts = {
  totalLabel: "Total investment",
  paidLabel: "Already paid",
  balanceLabel: "Balance due",
  paidInFullLabel: "Paid in full",
};
const scheduleOpts = { onlyUnpaid: true, hideWhenPaidInFull: true };

function scenarioBlocks(title, payments) {
  const b = baseBundle(payments, total);
  const issued = formatCurrentDateNy(new Date("2026-11-16T17:00:00Z"));
  const intro = `<h2>${title}</h2>
<p>Thank you for your payment. This receipt relates to your booking agreement with Xpress Entertainment.</p>
<p><strong>Client:</strong> Margie Weidman<br>
<strong>Event:</strong> Weidman Wedding<br>
<strong>Event number:</strong> 500123<br>
<strong>Event date:</strong> Saturday, August 15, 2026<br>
<strong>Date issued:</strong> ${issued}</p>`;
  return [
    { html: intro },
    { html: renderFeeTable(b, feeOpts) },
    { html: renderPaymentsReceived(b, payOpts) },
    { html: renderSummaryBox(b, summaryOpts) },
    { html: renderPaymentSchedule(b, scheduleOpts) },
  ].filter((block) => (block.html ?? "").trim() !== "");
}

const blocks = [
  ...scenarioBlocks("Sample A: Paid in full", paidInFullPayments),
  { html: `<hr class="xdoc-divider" />` },
  ...scenarioBlocks("Sample B: Balance due", balancePayments),
];

const html = wrapDocHtml({
  companyName: "Xpress Entertainment",
  kicker: "Payment Receipt",
  title: "Payment Receipt - Margie Weidman",
  sub: "Margie Weidman · August 15, 2026",
  signedLine: "drew@xpressdjs.com",
  blocks,
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
const outFile = join(outDir, "payment-receipt-invoice-style.pdf");
writeFileSync(outFile, pdf);
console.log(`Wrote ${outFile} (${pdf.length} bytes)`);

const artifactDir = "/opt/cursor/artifacts";
try {
  mkdirSync(artifactDir, { recursive: true });
  const artifact = join(artifactDir, "payment-receipt-invoice-style.pdf");
  copyFileSync(outFile, artifact);
  console.log(`Copied ${artifact}`);
} catch (err) {
  console.warn(`Could not copy to artifacts: ${err?.message ?? err}`);
}
