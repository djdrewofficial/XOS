/* Marketing SMS choices from the app. Separate from email consent and from
   transactional texts. STOP suppression stays on sms_opt_outs. */

export const SMS_MARKETING_DISCLOSURE_VERSION = "2026-11-06";

function toE164(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 10 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export type MarketingConsentAction = "grant" | "withdraw";

export type MarketingConsentEvent = {
  action: MarketingConsentAction;
  phone: string;
  createdAt: string;
  disclosureVersion: string;
  source: string;
};

/** Latest event wins. A grant is valid only for that exact E.164 number. */
export function currentMarketingConsent(
  events: MarketingConsentEvent[],
  phoneOnFile: string | null,
): { granted: boolean; event: MarketingConsentEvent | null; reason: "no_mobile_number" | null } {
  if (!phoneOnFile) return { granted: false, event: null, reason: "no_mobile_number" };
  const mine = events
    .filter((event) => event.phone === phoneOnFile)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const latest = mine[mine.length - 1] ?? null;
  return { granted: latest?.action === "grant", event: latest, reason: null };
}

/** Existing staff boolean still works when the app has no history.
    App history, when present, must match the destination number and still be granted.
    STOP is checked separately and is not decided here. */
export function marketingSendAllowed(input: {
  legacyOptIn: boolean;
  latest: { action: MarketingConsentAction; phone: string } | null;
  toNumber: string | null;
}): boolean {
  if (!input.latest) return input.legacyOptIn;
  if (input.latest.action !== "grant") return false;
  const to = toE164(input.toNumber ?? "");
  return Boolean(to) && to === input.latest.phone;
}

export function normalizeConsentPhone(raw: string | null | undefined): string | null {
  return toE164(raw ?? "");
}

export type MarketingHistoryRow = {
  authUserId: string | null;
  phone: string;
  action: MarketingConsentAction;
  createdAt: string;
};

/** Outbox gate. The staff boolean is used only after a successful read that found no app history.
    A failed read is not an empty history. Any history that was read, including a grant for an
    old number or a row for someone else's login, turns the boolean off. A send then needs the
    latest trusted row for the current booking number to be a grant, and the destination must
    be that number. */
export function marketingOutboxDecision(input: {
  legacyOptIn: boolean;
  accountAuthUserId: string | null;
  currentCellPhone: string | null;
  toNumber: string | null;
  /** null when the history query failed. An empty array is a successful read with no rows. */
  history: MarketingHistoryRow[] | null;
}): boolean {
  if (input.history == null) return false;
  if (input.history.length === 0) return input.legacyOptIn;
  const cell = normalizeConsentPhone(input.currentCellPhone);
  const to = normalizeConsentPhone(input.toNumber);
  if (!cell || !to || cell !== to) return false;
  const trusted = input.history
    .filter((row) =>
      marketingRowBoundToClient({
        rowAuthUserId: row.authUserId,
        accountAuthUserId: input.accountAuthUserId,
        rowPhone: row.phone,
        clientCellPhone: input.currentCellPhone,
      }),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return trusted[trusted.length - 1]?.action === "grant";
}

/** What the SMS drain should do with one claimed row.
    Transactional texts ignore consent history. Marketing is suppressed, not sent
    and not left queued, when the history read fails or consent is not established. */
export function smsMarketingDrainDecision(input: {
  isMarketing: boolean;
  clientId: string | null;
  legacyOptIn: boolean;
  accountAuthUserId: string | null;
  currentCellPhone: string | null;
  toNumber: string | null;
  historyReadOk: boolean;
  history: MarketingHistoryRow[];
}): { send: true } | { send: false; error: string } {
  if (!input.isMarketing) return { send: true };
  if (!input.historyReadOk) return { send: false, error: "SMS marketing consent could not be confirmed" };
  if (!input.clientId) return { send: false, error: "no SMS marketing consent on file" };
  const allowed = marketingOutboxDecision({
    legacyOptIn: input.legacyOptIn,
    accountAuthUserId: input.accountAuthUserId,
    currentCellPhone: input.currentCellPhone,
    toNumber: input.toNumber,
    history: input.history,
  });
  if (!allowed) return { send: false, error: "no SMS marketing consent on file" };
  return { send: true };
}

/** A history row counts only when it was written by that client's login
    and names the mobile number currently on the booking. */
export function marketingRowBoundToClient(input: {
  rowAuthUserId: string | null;
  accountAuthUserId: string | null;
  rowPhone: string;
  clientCellPhone: string | null;
}): boolean {
  if (!input.rowAuthUserId || !input.accountAuthUserId) return false;
  if (input.rowAuthUserId !== input.accountAuthUserId) return false;
  const cell = normalizeConsentPhone(input.clientCellPhone);
  return Boolean(cell) && cell === input.rowPhone;
}
