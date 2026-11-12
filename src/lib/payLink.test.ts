import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildPayUrl, truncatePayUrl } from "./payLink.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("buildPayUrl", () => {
  it("builds /pay/<token> from the app base URL", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://xos.xpressdjs.com";
    try {
      assert.equal(
        buildPayUrl("a1b2c3d4-e5f6-7890-abcd-ef1234567890"),
        "https://xos.xpressdjs.com/pay/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      );
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });

  it("strips a trailing slash on the base URL", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://xos.xpressdjs.com/";
    try {
      assert.equal(buildPayUrl("tok"), "https://xos.xpressdjs.com/pay/tok");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });

  it("returns null when the token is missing", () => {
    assert.equal(buildPayUrl(null), null);
    assert.equal(buildPayUrl(undefined), null);
    assert.equal(buildPayUrl(""), null);
    assert.equal(buildPayUrl("   "), null);
  });
});

describe("truncatePayUrl", () => {
  it("shortens a long token while keeping host and /pay/", () => {
    const url = "https://xos.xpressdjs.com/pay/a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const short = truncatePayUrl(url);
    assert.match(short, /^https:\/\/xos\.xpressdjs\.com\/pay\/a1b2…/);
    assert.ok(short.length < url.length);
  });

  it("leaves short URLs alone", () => {
    assert.equal(truncatePayUrl("https://xos.xpressdjs.com/pay/abc"), "https://xos.xpressdjs.com/pay/abc");
  });
});

describe("Copy payment link wiring", () => {
  it("office event page shows CopyPaymentLink when financials are not hidden", () => {
    const page = readFileSync(join(root, "src/app/(app)/events/[id]/page.tsx"), "utf8");
    assert.match(page, /import CopyPaymentLink from "@\/components\/CopyPaymentLink"/);
    assert.match(page, /import \{ buildPayUrl \} from "@\/lib\/payLink"/);
    assert.match(page, /!financialsHidden &&/);
    assert.match(page, /<CopyPaymentLink url=\{buildPayUrl\(event\.pay_token\)\} \/>/);
    assert.match(page, /BookingHelperBar/);
    // Field staff use a separate money-free page — no payment link there.
    const field = readFileSync(join(root, "src/app/(app)/events/[id]/FieldStaffEventPage.tsx"), "utf8");
    assert.doesNotMatch(field, /CopyPaymentLink/);
    assert.doesNotMatch(field, /buildPayUrl/);
  });

  it("CopyPaymentLink copies via clipboard API with a legacy fallback and shows the link", () => {
    const ui = readFileSync(join(root, "src/components/CopyPaymentLink.tsx"), "utf8");
    const lib = readFileSync(join(root, "src/lib/payLink.ts"), "utf8");
    assert.match(ui, /Payment link copied/);
    assert.match(ui, /Copy payment link/);
    assert.match(ui, /Show full link/);
    assert.match(ui, /No payment link on this event yet/);
    assert.match(ui, /copyTextToClipboard/);
    assert.match(ui, /w-full/);
    assert.match(lib, /navigator\.clipboard\.writeText/);
    assert.match(lib, /document\.execCommand\("copy"\)/);
    assert.match(lib, /from "@\/lib\/signing"/);
    assert.match(lib, /appUrl\(\)/);
  });
});
