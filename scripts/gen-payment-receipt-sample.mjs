#!/usr/bin/env node
/**
 * Generate docs/samples/payment-receipt-sample.pdf (and copy to /opt/cursor/artifacts)
 * using the same branded document shell + sample merge values as the email preview.
 * Does not touch the database or send mail.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

// Load TS modules the same way npm test does.
await import("./register-ts-ext.mjs");

const { wrapDocHtml } = await import(pathToFileURL(join(root, "src/lib/documentHtml.ts")).href);
const {
  PAYMENT_RECEIPT_DOC_BODY,
  applyMergeTags,
  paymentReceiptTags,
} = await import(pathToFileURL(join(root, "src/lib/paymentReceiptMerge.ts")).href);
const { htmlToPdf } = await import(pathToFileURL(join(root, "src/lib/pdf.ts")).href);

const XDOC_DEFAULT_ACCENT = "#4b328e";
const XDOC_DEFAULT_ACCENT_LIGHT = "#8b6fd6";

const logoPath = join(root, "public/logo-dark.png");
const logoData = existsSync(logoPath)
  ? `data:image/png;base64,${readFileSync(logoPath).toString("base64")}`
  : "";

const tags = paymentReceiptTags({
  totalFee: 3350,
  payments: [
    { amount: 200, method: "zelle", paidAt: "2026-09-01T15:00:00Z", processingFee: 0 },
    {
      amount: 1050,
      method: "paypal",
      paidAt: "2026-11-12T18:30:00Z",
      processingFee: 42,
      notes: "PayPal capture CAP-SAMPLE-42",
    },
  ],
});

const body = applyMergeTags(PAYMENT_RECEIPT_DOC_BODY, {
  client_name: "Jordan Rivera",
  event_name: "Jordan & Taylor Wedding",
  event_number: "500123",
  event_date_long: "Saturday, August 15, 2026",
  total_fee: "$3,350.00",
  ...tags,
});

const html = wrapDocHtml({
  companyName: "Xpress Entertainment",
  logoUrl: logoData || "https://xos.xpressdjs.com/logo-dark.png",
  accent: XDOC_DEFAULT_ACCENT,
  accentLight: XDOC_DEFAULT_ACCENT_LIGHT,
  footerLeft: "Xpress Entertainment · 11280 Pines Blvd, Pembroke Pines, FL 33026",
  docType: "receipt",
  title: "Payment Receipt",
  sub: "Jordan Rivera · August 15, 2026",
  signedLine: "drew@xpressdjs.com",
  blocks: [{ html: body }],
});

if (!process.env.CHROME_PATH) {
  for (const candidate of ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/local/bin/google-chrome"]) {
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
