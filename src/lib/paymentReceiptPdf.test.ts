import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { wrapDocHtml } from "./documentHtml.ts";
import {
  PAYMENT_RECEIPT_DOC_BODY,
  PAYMENT_RECEIPT_PDF_FILENAME,
  PAYMENT_RECEIPT_TEMPLATE_ID,
  applyMergeTags,
  paymentNotes,
  paymentReceiptTags,
  receiptPdfFilename,
} from "./paymentReceiptMerge.ts";
import { DOC_TYPE_CLIENT_LABELS, DOC_TYPES } from "./documentBlocks.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(
  join(root, "supabase/migrations/00228_payment_receipt_pdf.sql"),
  "utf8",
);

describe("payment receipt PDF helpers", () => {
  it("builds a client-facing filename without leftover tags or unsafe chars", () => {
    assert.equal(receiptPdfFilename("Xpress Receipt - 500123"), "Xpress Receipt - 500123.pdf");
    assert.equal(receiptPdfFilename("Xpress Receipt - <event_number>"), "Xpress Receipt -.pdf");
    assert.equal(receiptPdfFilename(""), "Xpress Receipt.pdf");
    assert.equal(PAYMENT_RECEIPT_PDF_FILENAME, "Xpress Receipt - <event_number>");
  });

  it("prefers payment notes over bank deposit reference", () => {
    assert.equal(
      paymentNotes({ amount: 1, method: "zelle", paidAt: "2026-01-01", notes: "Retainer", bankDepositRef: "REF" }),
      "Retainer",
    );
    assert.equal(
      paymentNotes({ amount: 1, method: "zelle", paidAt: "2026-01-01", notes: "  ", bankDepositRef: "DEP-9" }),
      "DEP-9",
    );
    assert.equal(paymentNotes(null), "");
  });

  it("includes notes in paymentReceiptTags and keeps booking-agreement wording", () => {
    const tags = paymentReceiptTags({
      totalFee: 1550,
      payments: [
        {
          amount: 1050,
          method: "paypal",
          paidAt: "2026-11-12T18:30:00Z",
          processingFee: 42,
          notes: "PayPal capture CAP-42",
        },
      ],
    });
    assert.equal(tags.most_recent_payment_notes, "PayPal capture CAP-42");
    const html = applyMergeTags(PAYMENT_RECEIPT_DOC_BODY, {
      client_name: "Jordan Rivera",
      event_name: "Jordan & Taylor Wedding",
      event_number: "500123",
      event_date_long: "Saturday, August 15, 2026",
      total_fee: "$1,550.00",
      ...tags,
    });
    assert.match(html, /booking agreement/);
    assert.match(html, /Investment total/);
    assert.match(html, /Paid to date/);
    assert.match(html, /Confirmation \/ notes: PayPal capture CAP-42/);
    assert.match(html, /Event number:<\/strong> 500123/);
    assert.doesNotMatch(html, /invoice/i);
    assert.doesNotMatch(html, /—/);
  });

  it("registers receipt as a document type with Payment Receipt client label", () => {
    assert.ok(DOC_TYPES.some(([v]) => v === "receipt"));
    assert.equal(DOC_TYPE_CLIENT_LABELS.receipt, "Payment Receipt");
  });
});

describe("migration 00228 payment receipt PDF", () => {
  it("seeds the Payment Receipt template and wires the Payment Received email", () => {
    assert.match(migration, /Payment Receipt PDF attachment/);
    assert.match(migration, /Payment Receipt/);
    assert.match(migration, /fresh_on_attach/);
    assert.match(migration, /pdf_filename/);
    assert.match(migration, /Xpress Receipt - <event_number>/);
    assert.match(migration, /document_logo_url/);
    assert.match(migration, /document_accent_color/);
    assert.match(migration, /document_footer_text/);
    assert.match(migration, /most_recent_payment_notes/);
    assert.match(migration, /event_number/);
    assert.match(migration, /attach_mode = 'pdf'/);
    assert.match(migration, /name = 'Payment Received'/);
    assert.match(migration, new RegExp(PAYMENT_RECEIPT_TEMPLATE_ID));
    assert.doesNotMatch(migration, /—/);
    // Seeded client-facing body must not say invoice (comments may mention the word).
    const bodyStart = migration.indexOf("$h$<p>Thank you for your payment");
    const bodyEnd = migration.indexOf("$h$\n        )", bodyStart);
    assert.ok(bodyStart > 0 && bodyEnd > bodyStart, "seeded receipt body missing");
    const seededBodies = migration.slice(bodyStart, migration.lastIndexOf("$h$", bodyEnd + 200) + 3);
    assert.doesNotMatch(seededBodies, /invoice/i);
    assert.match(migration, /booking agreement/);
  });

  it("resolves notes from the SQL helper the same way as TypeScript", async () => {
    const db = new PGlite();
    await db.exec(`
      create table payments (
        id uuid primary key,
        event_id uuid not null,
        amount numeric(10,2) not null,
        method text not null,
        paid_at timestamptz not null default now(),
        status text not null default 'approved',
        processing_fee numeric(10,2) not null default 0,
        notes text,
        bank_deposit_ref text,
        deleted_at timestamptz,
        created_at timestamptz not null default now()
      );
      create or replace function public.xos_format_payment_method(p_method text)
      returns text language sql immutable as $$
        select case
          when coalesce(p_method, '') = '' then ''
          when p_method ~ '[A-Z]' then p_method
          when lower(p_method) = 'paypal' then 'PayPal'
          else initcap(replace(p_method, '_', ' '))
        end;
      $$;
    `);
    const start = migration.indexOf("drop function if exists public.xos_payment_receipt_tags");
    const end = migration.indexOf("revoke all on function public.xos_payment_receipt_tags");
    assert.ok(start >= 0 && end > start, "payment receipt tags function missing");
    await db.exec(migration.slice(start, end));

    const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.exec(`
      insert into payments (id, event_id, amount, method, paid_at, processing_fee, notes, bank_deposit_ref, status) values
        ('11111111-1111-4111-8111-111111111111', '${eventId}', 1050, 'paypal', '2026-11-12T18:30:00Z', 42, null, 'DEP-99', 'approved');
    `);

    const { rows } = await db.query<{ notes: string; amount: string; method: string }>(
      `select * from public.xos_payment_receipt_tags($1::uuid)`,
      [eventId],
    );
    assert.equal(rows[0].amount, "$1,050.00");
    assert.equal(rows[0].method, "PayPal");
    assert.equal(rows[0].notes, "DEP-99");
  });
});

describe("wrapDocHtml receipt sample", () => {
  it("renders branded shell HTML for a filled receipt", () => {
    const tags = paymentReceiptTags({
      totalFee: 3350,
      payments: [
        { amount: 200, method: "zelle", paidAt: "2026-09-01T12:00:00Z" },
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
      logoUrl: "data:image/png;base64,iVBORw0KGgo=",
      accent: "#4b328e",
      accentLight: "#8b6fd6",
      footerLeft: "Xpress Entertainment",
      docType: "receipt",
      title: "Payment Receipt",
      sub: "Jordan Rivera · August 15, 2026",
      signedLine: "drew@xpressdjs.com",
      blocks: [{ html: body }],
    });
    assert.match(html, /Payment Receipt/);
    assert.match(html, /Jordan Rivera/);
    assert.match(html, /\$1,050\.00/);
    assert.match(html, /Paid in full|Remaining balance/);
    assert.match(html, /booking agreement/);
    assert.doesNotMatch(html, /invoice/i);
  });
});
