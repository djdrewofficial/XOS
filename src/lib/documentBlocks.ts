/* Document block registry — shared by the template builder, generator, and shell.
   Text blocks are written in the rich-text editor (merge tags supported).
   Smart blocks render from live event data at generation time and freeze. */

export type DocBlock = {
  id: string;
  type: "text" | "section" | "fee_table" | "payment_schedule" | "event_details" | "signature" | "divider";
  title?: string; // section blocks: the chapter heading (collapsible on the client page)
  html?: string; // text/section blocks: authored html (template) or merged html (document snapshot)
};

export const SMART_BLOCKS: { type: DocBlock["type"]; name: string; description: string }[] = [
  { type: "fee_table", name: "Fee Table", description: "Package (pinned version), add-ons, fees, discounts, total — from the event" },
  { type: "payment_schedule", name: "Payment Schedule", description: "The event's scheduled payments with due dates" },
  { type: "event_details", name: "Event Details", description: "Date, times, venue, guest count card" },
  { type: "signature", name: "Signature Block", description: "Client signature area (e-sign in phase 2)" },
  { type: "divider", name: "Divider", description: "A horizontal separator line" },
];

export const BLOCK_NAMES: Record<DocBlock["type"], string> = {
  text: "Text",
  section: "Section (collapsible chapter)",
  fee_table: "Fee Table",
  payment_schedule: "Payment Schedule",
  event_details: "Event Details",
  signature: "Signature Block",
  divider: "Divider",
};

export const DOC_TYPES = [
  ["contract", "Contract"],
  ["quote", "Quote"],
  ["invoice", "Invoice"],
  ["other", "Other"],
] as const;

/* Client-facing wording — we never say "contract" to clients; it's a Booking Agreement. */
export const DOC_TYPE_CLIENT_LABELS: Record<string, string> = {
  contract: "Booking Agreement",
  quote: "Quote",
  invoice: "Invoice",
  other: "Document",
};

export function docTypeClientLabel(t: string | null | undefined): string {
  return DOC_TYPE_CLIENT_LABELS[t ?? "other"] ?? "Document";
}

export function sanitizeBlocks(value: unknown): DocBlock[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(["text", "section", "fee_table", "payment_schedule", "event_details", "signature", "divider"]);
  return value
    .filter((b) => b && typeof b.id === "string" && valid.has(b.type))
    .map((b) => ({
      id: b.id,
      type: b.type,
      title: typeof b.title === "string" ? b.title : undefined,
      html: typeof b.html === "string" ? b.html : undefined,
    }));
}
