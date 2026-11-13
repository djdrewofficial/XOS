import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  PAYMENT_RECEIVED_BODY,
  PAYMENT_RECEIVED_SUBJECT,
  applyMergeTags,
  balanceStatus,
  formatPaymentMethod,
  paymentReceiptTags,
  totalPaid,
} from "./paymentReceiptMerge.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(
  join(root, "supabase/migrations/00226_payment_received_receipt.sql"),
  "utf8",
);

const SAMPLE_CLIENT = {
  first_name: "Alex",
  event_name: "Alex & Jordan Wedding",
  event_date_long: "November 12, 2026",
};

describe("formatPaymentMethod", () => {
  it("keeps display-cased methods and special-cases paypal", () => {
    assert.equal(formatPaymentMethod("paypal"), "PayPal");
    assert.equal(formatPaymentMethod("PayPal"), "PayPal");
    assert.equal(formatPaymentMethod("Credit Card"), "Credit Card");
    assert.equal(formatPaymentMethod("zelle"), "Zelle");
  });
});

describe("payment receipt merge tags", () => {
  it("shows remaining balance after a partial payment (fee not counted as paid)", () => {
    const tags = paymentReceiptTags({
      totalFee: 1550,
      payments: [
        {
          amount: 500,
          method: "Zelle",
          paidAt: "2026-09-01T15:00:00Z",
          processingFee: 0,
        },
      ],
    });
    assert.equal(tags.most_recent_payment_amount, "$500.00");
    assert.equal(tags.most_recent_payment_method, "Zelle");
    assert.equal(tags.most_recent_payment_processing_fee, "");
    assert.equal(tags.most_recent_payment_fee_line, "");
    assert.equal(tags.payments_received, "$500.00");
    assert.equal(tags.balance_due, "$1,050.00");
    assert.equal(tags.balance_status, "$1,050.00");
    assert.equal(balanceStatus(1550, [{ amount: 500, method: "Zelle", paidAt: "2026-09-01" }]), "$1,050.00");

    const rendered = applyMergeTags(PAYMENT_RECEIVED_BODY, {
      ...SAMPLE_CLIENT,
      ...tags,
    });
    assert.match(rendered, /Amount: <strong>\$500\.00<\/strong>/);
    assert.match(rendered, /Remaining balance: <strong>\$1,050\.00<\/strong>/);
    assert.doesNotMatch(rendered, /Card service fee/);
    assert.doesNotMatch(rendered, /Paid in full/);
    assert.doesNotMatch(rendered, /—/); // no em dashes in copy
    assert.doesNotMatch(rendered, /invoice/i);
  });

  it("shows Paid in full for the final PayPal payment with a separate card fee", () => {
    // $500 earlier + $1,050 now = $1,550 total paid toward the booking.
    // $42 card service fee is shown on its own line and does NOT change the balance.
    const tags = paymentReceiptTags({
      totalFee: 1550,
      payments: [
        { amount: 500, method: "Zelle", paidAt: "2026-09-01T15:00:00Z", processingFee: 0 },
        {
          amount: 1050,
          method: "paypal",
          paidAt: "2026-11-12T18:30:00Z",
          processingFee: 42,
        },
      ],
    });
    assert.equal(totalPaid([
      { amount: 500, method: "Zelle", paidAt: "2026-09-01T15:00:00Z" },
      { amount: 1050, method: "paypal", paidAt: "2026-11-12T18:30:00Z", processingFee: 42 },
    ]), 1550);
    assert.equal(tags.most_recent_payment_amount, "$1,050.00");
    assert.equal(tags.most_recent_payment_method, "PayPal");
    assert.equal(tags.most_recent_payment_processing_fee, "$42.00");
    assert.equal(tags.most_recent_payment_fee_line, "<br>Card service fee: <strong>$42.00</strong>");
    assert.equal(tags.payments_received, "$1,550.00");
    assert.equal(tags.balance_due, "$0.00");
    assert.equal(tags.balance_status, "Paid in full");

    const rendered = applyMergeTags(PAYMENT_RECEIVED_BODY, {
      ...SAMPLE_CLIENT,
      ...tags,
    });
    assert.match(rendered, /Amount: <strong>\$1,050\.00<\/strong>/);
    assert.match(rendered, /Method: <strong>PayPal<\/strong>/);
    assert.match(rendered, /Card service fee: <strong>\$42\.00<\/strong>/);
    assert.match(rendered, /Total paid so far: <strong>\$1,550\.00<\/strong>/);
    assert.match(rendered, /Remaining balance: <strong>Paid in full<\/strong>/);
    assert.doesNotMatch(rendered, /Remaining balance: <strong>\$0\.00<\/strong>/);
    assert.doesNotMatch(rendered, /—/);
    assert.doesNotMatch(rendered, /invoice/i);
    assert.match(rendered, /booking agreement/);
  });

  it("ignores pending and soft-deleted payments for totals and latest payment", () => {
    const tags = paymentReceiptTags({
      totalFee: 1000,
      payments: [
        { amount: 1000, method: "cash", paidAt: "2026-11-01", status: "pending" },
        { amount: 400, method: "zelle", paidAt: "2026-11-02", deletedAt: "2026-11-03" },
        { amount: 250, method: "zelle", paidAt: "2026-11-04" },
      ],
    });
    assert.equal(tags.payments_received, "$250.00");
    assert.equal(tags.most_recent_payment_amount, "$250.00");
    assert.equal(tags.balance_status, "$750.00");
  });
});

describe("migration 00226 payment received receipt", () => {
  it("seeds the English template copy and registers the new merge tags", () => {
    assert.match(migration, /name = 'Payment Received'/);
    assert.match(migration, /most_recent_payment_amount/);
    assert.match(migration, /most_recent_payment_method/);
    assert.match(migration, /most_recent_payment_date/);
    assert.match(migration, /most_recent_payment_processing_fee/);
    assert.match(migration, /most_recent_payment_fee_line/);
    assert.match(migration, /balance_status/);
    assert.match(migration, /Paid in full/);
    assert.match(migration, /booking agreement/);
    assert.doesNotMatch(migration, /invoice/i);
    assert.doesNotMatch(migration, /—/);
    assert.match(migration, /hide_if_already_ran, auto_on_payment, actions/);
    assert.match(migration, /Send Payment Received Receipt/);
    // Values list: hide_if_already_ran false, auto_on_payment false (must not auto-send).
    assert.match(
      migration,
      /Send Payment Received Receipt[\s\S]*?false,\s*false,\s*jsonb_build_array/,
    );
    // Template body in SQL matches the TS constant (tags present).
    for (const tag of [
      "most_recent_payment_amount",
      "most_recent_payment_method",
      "most_recent_payment_date",
      "most_recent_payment_fee_line",
      "payments_received",
      "balance_status",
    ]) {
      assert.match(migration, new RegExp(`<${tag}>`));
      assert.match(PAYMENT_RECEIVED_BODY, new RegExp(`<${tag}>`));
    }
    assert.match(PAYMENT_RECEIVED_SUBJECT, /Payment received for <event_name>/);
  });

  it("resolves the new tags in SQL the same way as the TypeScript helper", async () => {
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
        deleted_at timestamptz,
        created_at timestamptz not null default now()
      );
    `);
    // Load the three SQL helpers from the migration (format + receipt tags + balance status).
    const start = migration.indexOf("create or replace function public.xos_format_payment_method");
    const end = migration.indexOf("revoke all on function public.xos_format_payment_method");
    assert.ok(start >= 0 && end > start, "payment receipt SQL helpers missing from migration");
    await db.exec(migration.slice(start, end));

    const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.exec(`
      insert into payments (id, event_id, amount, method, paid_at, processing_fee, status) values
        ('11111111-1111-4111-8111-111111111111', '${eventId}', 500, 'Zelle', '2026-09-01T15:00:00Z', 0, 'approved'),
        ('22222222-2222-4222-8222-222222222222', '${eventId}', 1050, 'paypal', '2026-11-12T18:30:00Z', 42, 'approved'),
        ('33333333-3333-4333-8333-333333333333', '${eventId}', 999, 'cash', '2026-11-13T18:30:00Z', 0, 'pending');
    `);

    const { rows } = await db.query<{
      amount: string;
      method: string;
      fee: string;
      fee_line: string;
    }>(
      `select * from public.xos_payment_receipt_tags($1::uuid)`,
      [eventId],
    );
    const row = rows[0];
    assert.equal(row.amount, "$1,050.00");
    assert.equal(row.method, "PayPal");
    assert.equal(row.fee, "$42.00");
    assert.equal(row.fee_line, "<br>Card service fee: <strong>$42.00</strong>");

    const bal = await db.query<{ status: string }>(
      `select public.xos_balance_status(1550::numeric, $1::uuid) as status`,
      [eventId],
    );
    assert.equal(bal.rows[0].status, "Paid in full");

    const partial = await db.query<{ status: string }>(
      `select public.xos_balance_status(1550::numeric, $1::uuid) as status`,
      ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    );
    // No payments for that event → full balance owed
    assert.equal(partial.rows[0].status, "$1,550.00");
  });
});
