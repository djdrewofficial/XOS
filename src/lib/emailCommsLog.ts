/**
 * Shared post-send step: every XOS client email must land in Comms (hl_messages)
 * and on the matching GHL contact. Callers deliver via Mailgun/HL first; this
 * never throws to the caller and never blocks the send.
 */

export type CommsSourceKind =
  | "scheduled_template"
  | "booking_helper"
  | "payment_reminder"
  | "manual"
  | "system"
  | "other";

export type GhlSyncStatus = "pending" | "synced" | "failed" | "skipped";

export type EventClientRow = {
  clientId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isPrimary: boolean;
  role: string | null;
};

export type HlConversationRow = {
  id: string;
  hl_contact_id: string | null;
  last_message_at: string | null;
  client_id: string | null;
  email: string | null;
};

export type EmailCommsLogInput = {
  emailLogId: string;
  eventId: string | null;
  clientId: string | null;
  toEmail: string;
  fromName?: string | null;
  fromEmail?: string | null;
  subject: string;
  html: string;
  sentAt: string;
  attachments?: { filename?: string; url?: string }[];
  sourceKind?: CommsSourceKind | null;
  sourceLabel?: string | null;
  helperId?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  /** True when GHL already has a real email copy (OAuth thread or HL send). */
  alreadyInGhl?: boolean;
  ghlMessageId?: string | null;
};

export type EmailCommsLogResult = {
  ok: boolean;
  recipientClientId: string | null;
  conversationId: string | null;
  mirroredClientIds: string[];
  ghlSyncStatus: GhlSyncStatus;
  ghlMessageId: string | null;
  ghlError: string | null;
};

export type EmailCommsLogDeps = {
  isHighLevelConfigured: () => boolean;
  listEventClients: (eventId: string) => Promise<EventClientRow[]>;
  findConversationByClientId: (clientId: string) => Promise<HlConversationRow | null>;
  findConversationByEmail: (email: string) => Promise<HlConversationRow | null>;
  findEmployeeByEmail: (
    email: string,
  ) => Promise<{ id: string; firstName: string | null; lastName: string | null; phone: string | null } | null>;
  upsertGhlContact: (opts: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  }) => Promise<{ ok: true; contactId: string } | { ok: false; error: string }>;
  findGhlConversationId: (contactId: string) => Promise<string | null>;
  createGhlConversation: (contactId: string) => Promise<string | null>;
  upsertHlConversation: (row: {
    id: string;
    hl_contact_id: string | null;
    client_id: string | null;
    contact_name: string | null;
    email: string;
  }) => Promise<void>;
  upsertHlMessage: (row: {
    id: string;
    conversation_id: string;
    direction: string;
    message_type: string;
    status: string;
    body: string;
    to_number: string;
    date_added: string;
    meta: Record<string, unknown>;
  }) => Promise<void>;
  updateConversationPreview: (
    conversationId: string,
    patch: {
      last_message_at: string;
      last_message_type: string;
      last_message_direction: string;
      last_message_body: string;
    },
  ) => Promise<void>;
  /** Log-without-send into the GHL conversation timeline (preferred). */
  logEmailInGhl: (opts: {
    contactId: string;
    toEmail: string;
    fromName?: string | null;
    fromEmail?: string | null;
    subject: string;
    html: string;
    sentAt: string;
    altId: string;
    attachmentUrls?: string[];
  }) => Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }>;
  leaveGhlNote: (contactId: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  updateEmailLog: (
    emailLogId: string,
    patch: {
      client_id?: string | null;
      helper_id?: string | null;
      comms_source?: string | null;
      comms_source_label?: string | null;
      ghl_sync_status?: GhlSyncStatus;
      ghl_sync_error?: string | null;
      ghl_synced_at?: string | null;
      ghl_message_id?: string | null;
      hl_conversation_id?: string | null;
    },
  ) => Promise<void>;
};

const SOURCE_LABELS: Record<CommsSourceKind, string> = {
  scheduled_template: "Scheduled template",
  booking_helper: "Booking helper",
  payment_reminder: "Payment reminder",
  manual: "Manual send",
  system: "System",
  other: "XOS email",
};

export function stripHtmlForComms(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Prefer the event_clients row whose email matches the recipient. */
export function resolveRecipientClientId(
  toEmail: string,
  eventClients: EventClientRow[],
  fallbackClientId: string | null,
): string | null {
  const email = normalizeEmail(toEmail);
  if (!email) return fallbackClientId;
  const match = eventClients.find((c) => c.email && normalizeEmail(c.email) === email);
  if (match) return match.clientId;
  if (fallbackClientId && eventClients.some((c) => c.clientId === fallbackClientId)) {
    return fallbackClientId;
  }
  return fallbackClientId;
}

export function buildSourceLabel(opts: {
  sourceKind?: CommsSourceKind | null;
  sourceLabel?: string | null;
  templateName?: string | null;
}): string {
  if (opts.sourceLabel?.trim()) return opts.sourceLabel.trim();
  const kind = opts.sourceKind ?? "other";
  const base = SOURCE_LABELS[kind] ?? SOURCE_LABELS.other;
  if (opts.templateName?.trim()) return `${base}: ${opts.templateName.trim()}`;
  return base;
}

export function mirrorMessageId(emailLogId: string, forClientId?: string | null): string {
  if (forClientId) return `xos-email-${emailLogId}-for-${forClientId}`;
  return `xos-email-${emailLogId}`;
}

export function deriveCommsSource(opts: {
  helperId?: string | null;
  scheduleEnabled?: boolean | null;
  isPaymentReminder?: boolean | null;
  bypassCommsPause?: boolean | null;
}): CommsSourceKind {
  if (opts.helperId) return "booking_helper";
  if (opts.isPaymentReminder) return "payment_reminder";
  if (opts.scheduleEnabled) return "scheduled_template";
  if (opts.bypassCommsPause) return "booking_helper";
  return "manual";
}

/**
 * Pure-ish orchestration (I/O via deps). Safe to call after every successful
 * provider send. GHL failures are recorded on email_log and never thrown.
 */
export async function recordOutboundEmailComms(
  input: EmailCommsLogInput,
  deps: EmailCommsLogDeps,
): Promise<EmailCommsLogResult> {
  const empty: EmailCommsLogResult = {
    ok: false,
    recipientClientId: null,
    conversationId: null,
    mirroredClientIds: [],
    ghlSyncStatus: "skipped",
    ghlMessageId: null,
    ghlError: null,
  };

  try {
    const email = normalizeEmail(input.toEmail);
    if (!email) return empty;

    const eventClients = input.eventId ? await deps.listEventClients(input.eventId) : [];
    const recipientClientId = resolveRecipientClientId(email, eventClients, input.clientId);
    const sourceKind = input.sourceKind ?? "other";
    const sourceLabel = buildSourceLabel({
      sourceKind,
      sourceLabel: input.sourceLabel,
      templateName: input.templateName,
    });

    // Stamp resolved client + source on the log row early so retries/backfill see it.
    await deps.updateEmailLog(input.emailLogId, {
      client_id: recipientClientId,
      helper_id: input.helperId ?? undefined,
      comms_source: sourceKind,
      comms_source_label: sourceLabel,
      ghl_sync_status: input.alreadyInGhl ? "synced" : "pending",
      ghl_message_id: input.ghlMessageId ?? undefined,
    });

    const recipientProfile =
      eventClients.find((c) => c.clientId === recipientClientId) ??
      (recipientClientId
        ? {
            clientId: recipientClientId,
            email,
            firstName: null as string | null,
            lastName: null as string | null,
            phone: null as string | null,
            isPrimary: false,
            role: null as string | null,
          }
        : null);

    let conv: HlConversationRow | null = null;
    if (recipientClientId) {
      conv = await deps.findConversationByClientId(recipientClientId);
    }
    if (!conv) {
      conv = await deps.findConversationByEmail(email);
    }

    const staff =
      !recipientClientId && !conv
        ? await deps.findEmployeeByEmail(email)
        : null;

    // Vendor/custom addresses with no existing thread and no client/staff link stay out of Comms.
    if (!conv && !recipientClientId && !staff) {
      await deps.updateEmailLog(input.emailLogId, {
        ghl_sync_status: "skipped",
        ghl_sync_error: "No client, staff, or existing conversation for recipient",
      });
      return { ...empty, ghlSyncStatus: "skipped", ghlError: "no matching contact" };
    }

    let contactId = conv?.hl_contact_id ?? null;
    if (deps.isHighLevelConfigured() && (!conv || !contactId)) {
      const up = await deps.upsertGhlContact({
        email,
        firstName: recipientProfile?.firstName ?? staff?.firstName ?? null,
        lastName: recipientProfile?.lastName ?? staff?.lastName ?? null,
        phone: recipientProfile?.phone ?? staff?.phone ?? null,
      });
      if (up.ok) contactId = up.contactId;
      if (!conv && contactId) {
        let convId = await deps.findGhlConversationId(contactId);
        if (!convId) convId = await deps.createGhlConversation(contactId);
        if (convId) {
          const name = recipientProfile
            ? `${recipientProfile.firstName ?? ""} ${recipientProfile.lastName ?? ""}`.trim()
            : staff
              ? `${staff.firstName ?? ""} ${staff.lastName ?? ""}`.trim()
              : "";
          await deps.upsertHlConversation({
            id: convId,
            hl_contact_id: contactId,
            client_id: recipientClientId,
            contact_name: name || email,
            email,
          });
          conv = { id: convId, hl_contact_id: contactId, last_message_at: null, client_id: recipientClientId, email };
        }
      }
    }

    const body = stripHtmlForComms(input.html).slice(0, 20_000);
    const baseMeta: Record<string, unknown> = {
      subject: input.subject,
      emailHtml: input.html.slice(0, 100_000),
      source: "xos",
      emailLogId: input.emailLogId,
      eventId: input.eventId,
      sourceKind,
      sourceLabel,
      ...(input.helperId ? { helperId: input.helperId } : {}),
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.templateName ? { templateName: input.templateName } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.ghlMessageId ? { ghlMessageId: input.ghlMessageId } : {}),
    };

    const mirroredClientIds: string[] = [];

    // Always mirror locally so Comms updates immediately (even when GHL already has a copy).
    if (conv) {
      await deps.upsertHlMessage({
        id: mirrorMessageId(input.emailLogId),
        conversation_id: conv.id,
        direction: "outbound",
        message_type: "TYPE_EMAIL",
        status: "sent",
        body,
        to_number: email,
        date_added: input.sentAt,
        meta: baseMeta,
      });
      if (!conv.last_message_at || conv.last_message_at < input.sentAt) {
        await deps.updateConversationPreview(conv.id, {
          last_message_at: input.sentAt,
          last_message_type: "TYPE_EMAIL",
          last_message_direction: "outbound",
          last_message_body: `${input.subject}`.slice(0, 500),
        });
      }
      if (recipientClientId) mirroredClientIds.push(recipientClientId);
    }

    // Fan-out onto other linked event_clients' conversations so every chip on
    // the event Comms tab shows the send (labelled with who it went to).
    if (input.eventId && eventClients.length > 1) {
      for (const ec of eventClients) {
        if (recipientClientId && ec.clientId === recipientClientId) continue;
        const other = await deps.findConversationByClientId(ec.clientId);
        if (!other) continue;
        const sentToName = recipientProfile
          ? `${recipientProfile.firstName ?? ""} ${recipientProfile.lastName ?? ""}`.trim() || email
          : email;
        await deps.upsertHlMessage({
          id: mirrorMessageId(input.emailLogId, ec.clientId),
          conversation_id: other.id,
          direction: "outbound",
          message_type: "TYPE_EMAIL",
          status: "sent",
          body,
          to_number: email,
          date_added: input.sentAt,
          meta: {
            ...baseMeta,
            sharedOnEvent: true,
            sentTo: email,
            sentToName,
            sourceLabel: `${sourceLabel} · to ${sentToName}`,
          },
        });
        mirroredClientIds.push(ec.clientId);
      }
    }

    let ghlSyncStatus: GhlSyncStatus = input.alreadyInGhl ? "synced" : "pending";
    let ghlMessageId: string | null = input.ghlMessageId ?? null;
    let ghlError: string | null = null;

    if (input.alreadyInGhl) {
      ghlSyncStatus = "synced";
      await deps.updateEmailLog(input.emailLogId, {
        ghl_sync_status: "synced",
        ghl_synced_at: new Date().toISOString(),
        ghl_message_id: ghlMessageId,
        ghl_sync_error: null,
        hl_conversation_id: conv?.id ?? null,
        client_id: recipientClientId,
      });
    } else if (contactId && deps.isHighLevelConfigured()) {
      const logged = await deps.logEmailInGhl({
        contactId,
        toEmail: email,
        fromName: input.fromName,
        fromEmail: input.fromEmail,
        subject: input.subject,
        html: input.html,
        sentAt: input.sentAt,
        altId: input.emailLogId,
        attachmentUrls: input.attachments?.map((a) => a.url).filter((u): u is string => !!u),
      });
      if (logged.ok) {
        ghlSyncStatus = "synced";
        ghlMessageId = logged.messageId;
        await deps.updateEmailLog(input.emailLogId, {
          ghl_sync_status: "synced",
          ghl_synced_at: new Date().toISOString(),
          ghl_message_id: ghlMessageId,
          ghl_sync_error: null,
          hl_conversation_id: conv?.id ?? null,
          client_id: recipientClientId,
        });
      } else {
        // Fall back to a contact note so activity still appears in GHL.
        const excerpt = body.length > 1500 ? `${body.slice(0, 1500)}…` : body;
        const note = await deps.leaveGhlNote(
          contactId,
          `📧 Email sent from XOS to ${email}\nSubject: ${input.subject}\nSource: ${sourceLabel}\n\n${excerpt}`,
        );
        ghlSyncStatus = "failed";
        ghlError = logged.error;
        await deps.updateEmailLog(input.emailLogId, {
          ghl_sync_status: "failed",
          ghl_sync_error: `${logged.error}${note.ok ? "" : `; note also failed: ${note.error ?? "unknown"}`}`.slice(
            0,
            500,
          ),
          hl_conversation_id: conv?.id ?? null,
          client_id: recipientClientId,
        });
      }
    } else {
      ghlSyncStatus = deps.isHighLevelConfigured() ? "failed" : "skipped";
      ghlError = deps.isHighLevelConfigured() ? "No GHL contact id" : "HighLevel not configured";
      await deps.updateEmailLog(input.emailLogId, {
        ghl_sync_status: ghlSyncStatus,
        ghl_sync_error: ghlError,
        hl_conversation_id: conv?.id ?? null,
        client_id: recipientClientId,
      });
    }

    return {
      ok: true,
      recipientClientId,
      conversationId: conv?.id ?? null,
      mirroredClientIds,
      ghlSyncStatus,
      ghlMessageId,
      ghlError,
    };
  } catch (err) {
    const message = String(err).slice(0, 500);
    try {
      await deps.updateEmailLog(input.emailLogId, {
        ghl_sync_status: "failed",
        ghl_sync_error: message,
      });
    } catch {
      /* ignore secondary failure */
    }
    return { ...empty, ghlSyncStatus: "failed", ghlError: message };
  }
}
