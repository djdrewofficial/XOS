/* Document block registry — shared by the template builder, generator, and shell.
   Text blocks are written in the rich-text editor (merge tags supported).
   Smart blocks render from live event data at generation time and freeze.
   Money smart blocks accept optional UI-editable `options` (fee table columns,
   payment notes, unpaid-only schedule, summary labels, etc.). */

export type FeeTableOptions = {
  /** Show package/add-on description under the name. Default true. */
  showDescriptions?: boolean;
  /** Separate Qty + Unit Price columns (invoice-style). Default false. */
  showQty?: boolean;
  /** Footer total label. Default "Total Investment". */
  totalLabel?: string;
};

export type PaymentsReceivedOptions = {
  /** Show a Notes column. Default false. When off, reason/bank-deposit fallbacks never print.
      When on, only the notes field prints (DJEP/PayPal import noise stripped). */
  showNotes?: boolean;
};

export type PaymentScheduleOptions = {
  /** Only list unpaid / upcoming installments. Default false. */
  onlyUnpaid?: boolean;
  /** Omit the whole block when balance is paid in full. Default false. */
  hideWhenPaidInFull?: boolean;
};

export type SummaryBoxOptions = {
  totalLabel?: string;
  paidLabel?: string;
  /** Left-side label for the balance row (always). Default "Balance due". */
  balanceLabel?: string;
  /** Right-side value when balance is zero. Default "Paid in full". */
  paidInFullLabel?: string;
};

/** Text blocks: alternate / hide when venue-paid (financials hidden). */
export type TextBlockOptions = {
  /** Omit this text block entirely on financials-hidden events. Default false. */
  hideWhenFinancialsHidden?: boolean;
  /** Alternate HTML (merge tags OK) used instead of `html` when financials are hidden. */
  financialsHiddenHtml?: string;
};

/** Optional heading printed above a smart block (e.g. "Line Items"). */
export type BlockHeadingOptions = {
  heading?: string;
};

export type DocBlockOptions = FeeTableOptions &
  PaymentsReceivedOptions &
  PaymentScheduleOptions &
  SummaryBoxOptions &
  TextBlockOptions &
  BlockHeadingOptions;

export type DocBlock = {
  id: string;
  type:
    | "text"
    | "section"
    | "fee_table"
    | "payment_schedule"
    | "payments_received"
    | "summary_box"
    | "event_details"
    | "signature"
    | "divider";
  title?: string; // section blocks: the chapter heading (collapsible on the client page)
  html?: string; // text/section blocks: authored html (template) or merged html (document snapshot)
  options?: DocBlockOptions;
};

export const SMART_BLOCKS: { type: DocBlock["type"]; name: string; description: string }[] = [
  {
    type: "fee_table",
    name: "Fee Table",
    description: "Package, add-ons, fees, discounts, and total. Options: descriptions, qty/unit columns, total label.",
  },
  {
    type: "payment_schedule",
    name: "Payment Schedule",
    description: "Scheduled payments with due dates. Options: unpaid only, hide when paid in full.",
  },
  {
    type: "payments_received",
    name: "Payments Received",
    description: "Actual payments: date, method, amount. Optional notes column (DJEP import noise stripped).",
  },
  {
    type: "summary_box",
    name: "Payment Summary",
    description: "Highlighted box: total investment, already paid, balance due (value can say paid in full). Labels editable.",
  },
  { type: "event_details", name: "Event Details", description: "Date, times, venue, guest count card" },
  { type: "signature", name: "Signature Block", description: "Client signature area (e-sign)" },
  { type: "divider", name: "Divider", description: "A horizontal separator line" },
];

export const BLOCK_NAMES: Record<DocBlock["type"], string> = {
  text: "Text",
  section: "Section (collapsible chapter)",
  fee_table: "Fee Table",
  payment_schedule: "Payment Schedule",
  payments_received: "Payments Received",
  summary_box: "Payment Summary",
  event_details: "Event Details",
  signature: "Signature Block",
  divider: "Divider",
};

export const DOC_TYPES = [
  ["contract", "Contract"],
  ["quote", "Quote"],
  ["invoice", "Invoice"],
  ["receipt", "Receipt"],
  ["other", "Other"],
] as const;

/* Client-facing wording. We never say "contract" to clients; it's a Booking Agreement.
   Receipts show as Payment Receipt in the PDF header kicker unless overridden. */
export const DOC_TYPE_CLIENT_LABELS: Record<string, string> = {
  contract: "Booking Agreement",
  quote: "Quote",
  invoice: "Invoice",
  receipt: "Payment Receipt",
  other: "Document",
};

export function docTypeClientLabel(t: string | null | undefined): string {
  return DOC_TYPE_CLIENT_LABELS[t ?? "other"] ?? "Document";
}

/** Default PDF header kicker for a doc type (editable per template via header_kicker). */
export function defaultHeaderKicker(docType: string | null | undefined): string {
  return docTypeClientLabel(docType);
}

export const DEFAULT_FEE_TOTAL_LABEL = "Total Investment";
export const DEFAULT_SUMMARY_TOTAL_LABEL = "Total investment";
export const DEFAULT_SUMMARY_PAID_LABEL = "Already paid";
export const DEFAULT_SUMMARY_BALANCE_LABEL = "Balance due";
export const DEFAULT_SUMMARY_PAID_IN_FULL_LABEL = "Paid in full";

/** Normalize / clamp smart-block options for a given type (unknown keys dropped). */
export function sanitizeBlockOptions(type: DocBlock["type"], raw: unknown): DocBlockOptions | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: DocBlockOptions = {};

  const bool = (k: string) => (typeof o[k] === "boolean" ? (o[k] as boolean) : undefined);
  const label = (k: string) => {
    if (typeof o[k] !== "string") return undefined;
    const t = (o[k] as string).trim();
    return t || undefined;
  };
  const heading = label("heading");
  if (heading !== undefined) out.heading = heading.slice(0, 120);

  if (type === "fee_table") {
    const showDescriptions = bool("showDescriptions");
    const showQty = bool("showQty");
    const totalLabel = label("totalLabel");
    if (showDescriptions !== undefined) out.showDescriptions = showDescriptions;
    if (showQty !== undefined) out.showQty = showQty;
    if (totalLabel !== undefined) out.totalLabel = totalLabel.slice(0, 80);
    return Object.keys(out).length ? out : undefined;
  }
  if (type === "payments_received") {
    const showNotes = bool("showNotes");
    if (showNotes !== undefined) out.showNotes = showNotes;
    return Object.keys(out).length ? out : undefined;
  }
  if (type === "payment_schedule") {
    const onlyUnpaid = bool("onlyUnpaid");
    const hideWhenPaidInFull = bool("hideWhenPaidInFull");
    if (onlyUnpaid !== undefined) out.onlyUnpaid = onlyUnpaid;
    if (hideWhenPaidInFull !== undefined) out.hideWhenPaidInFull = hideWhenPaidInFull;
    return Object.keys(out).length ? out : undefined;
  }
  if (type === "summary_box") {
    const totalLabel = label("totalLabel");
    const paidLabel = label("paidLabel");
    const balanceLabel = label("balanceLabel");
    const paidInFullLabel = label("paidInFullLabel");
    if (totalLabel !== undefined) out.totalLabel = totalLabel.slice(0, 80);
    if (paidLabel !== undefined) out.paidLabel = paidLabel.slice(0, 80);
    if (balanceLabel !== undefined) out.balanceLabel = balanceLabel.slice(0, 80);
    if (paidInFullLabel !== undefined) out.paidInFullLabel = paidInFullLabel.slice(0, 80);
    return Object.keys(out).length ? out : undefined;
  }
  if (type === "text") {
    const hideWhenFinancialsHidden = bool("hideWhenFinancialsHidden");
    if (hideWhenFinancialsHidden !== undefined) out.hideWhenFinancialsHidden = hideWhenFinancialsHidden;
    if (typeof o.financialsHiddenHtml === "string") {
      const alt = sanitizeDocumentHtml(o.financialsHiddenHtml);
      if (alt.trim()) out.financialsHiddenHtml = alt;
    }
    return Object.keys(out).length ? out : undefined;
  }
  // heading-only is only meaningful on money smart blocks above
  return undefined;
}

export function sanitizeDocumentHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+|192\.168\.\d+|169\.254\.\d+|172\.(?:1[6-9]|2\d|3[0-1])\.\d+)[^\s"'<>]*/gi, "");
}

export function sanitizeBlocks(value: unknown): DocBlock[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set([
    "text",
    "section",
    "fee_table",
    "payment_schedule",
    "payments_received",
    "summary_box",
    "event_details",
    "signature",
    "divider",
  ]);
  return value
    .filter((b) => b && typeof b.id === "string" && valid.has(b.type))
    .map((b) => {
      const type = b.type as DocBlock["type"];
      const options = sanitizeBlockOptions(type, b.options);
      return {
        id: b.id as string,
        type,
        title: typeof b.title === "string" ? b.title : undefined,
        html: typeof b.html === "string" ? sanitizeDocumentHtml(b.html) : undefined,
        ...(options ? { options } : {}),
      };
    });
}

/** Build a generated document title from an editable template format.
   Placeholders: {template}, {client}, {event}. Default uses a plain hyphen (no em dash). */
export function formatDocumentTitle(
  format: string | null | undefined,
  parts: { template: string; client: string; event: string },
): string {
  const fallback = "{template} - {client}";
  const raw = (format ?? "").trim() || fallback;
  const clientOrEvent = parts.client || parts.event || "Event";
  return raw
    .replaceAll("{template}", parts.template)
    .replaceAll("{client}", clientOrEvent)
    .replaceAll("{event}", parts.event || parts.client || "Event")
    .replace(/\s+/g, " ")
    .trim();
}

/** Default alternate intro when venue-paid / financials are hidden (no em dash). */
export const DEFAULT_RECEIPT_FINANCIALS_HIDDEN_HTML = `<p>Thanks, &lt;first_name&gt;! Here is a summary of the services for your event.</p>
<p><strong>Event:</strong> &lt;event_name&gt;<br>
<strong>Date:</strong> &lt;event_date_long&gt;<br>
<strong>Venue:</strong> &lt;venue_name&gt;</p>`;

/** Recommended Payment Receipt template blocks (invoice-style layout). */
export function paymentReceiptInvoiceBlocks(): DocBlock[] {
  return [
    {
      id: "receipt-intro",
      type: "text",
      html: `<p>Thanks, &lt;first_name&gt;! Here is a summary of your booking and payments.</p>
<p><strong>Event:</strong> &lt;event_name&gt;<br>
<strong>Date:</strong> &lt;event_date_long&gt;<br>
<strong>Venue:</strong> &lt;venue_name&gt;</p>`,
      options: {
        hideWhenFinancialsHidden: false,
        financialsHiddenHtml: DEFAULT_RECEIPT_FINANCIALS_HIDDEN_HTML,
      },
    },
    {
      id: "receipt-fees",
      type: "fee_table",
      options: {
        heading: "Line Items",
        showDescriptions: true,
        showQty: true,
        totalLabel: "Total Investment",
      },
    },
    {
      id: "receipt-payments",
      type: "payments_received",
      options: { heading: "Payments Received", showNotes: false },
    },
    {
      id: "receipt-summary",
      type: "summary_box",
      options: {
        heading: "Summary",
        totalLabel: "Total investment",
        paidLabel: "Already paid",
        balanceLabel: "Balance due",
        paidInFullLabel: "Paid in full",
      },
    },
    {
      id: "receipt-schedule",
      type: "payment_schedule",
      options: {
        heading: "Upcoming Payments",
        onlyUnpaid: true,
        hideWhenPaidInFull: true,
      },
    },
  ];
}
