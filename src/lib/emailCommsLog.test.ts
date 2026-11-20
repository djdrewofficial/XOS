import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSourceLabel,
  deriveCommsSource,
  mirrorMessageId,
  normalizeEmail,
  recordOutboundEmailComms,
  resolveRecipientClientId,
  stripHtmlForComms,
  type EmailCommsLogDeps,
  type EmailCommsLogInput,
  type EventClientRow,
  type HlConversationRow,
} from "./emailCommsLog.ts";

const EVENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PRIMARY = "11111111-1111-1111-1111-111111111111";
const COCLIENT = "22222222-2222-2222-2222-222222222222";
const LOG_ID = "33333333-3333-3333-3333-333333333333";

const eventClients: EventClientRow[] = [
  {
    clientId: PRIMARY,
    email: "bride@example.com",
    firstName: "Ada",
    lastName: "Bride",
    phone: "+15551110000",
    isPrimary: true,
    role: "Contract Holder",
  },
  {
    clientId: COCLIENT,
    email: "groom@example.com",
    firstName: "Bob",
    lastName: "Groom",
    phone: "+15552220000",
    isPrimary: false,
    role: "Client",
  },
];

function baseInput(partial: Partial<EmailCommsLogInput> = {}): EmailCommsLogInput {
  return {
    emailLogId: LOG_ID,
    eventId: EVENT,
    clientId: PRIMARY,
    toEmail: "groom@example.com",
    fromName: "Xpress",
    fromEmail: "events@xpressdjs.com",
    subject: "Payment received",
    html: "<p>Thanks <strong>Bob</strong></p>",
    sentAt: "2026-11-20T12:00:00.000Z",
    sourceKind: "booking_helper",
    templateName: "Payment Received",
    helperId: "a0248b63-aaaa-bbbb-cccc-ddddeeeeffff",
    ...partial,
  };
}

function makeDeps(overrides: Partial<EmailCommsLogDeps> = {}): EmailCommsLogDeps & {
  updates: Record<string, unknown>[];
  messages: { id: string; conversation_id: string; meta: Record<string, unknown> }[];
  ghlLogs: unknown[];
  notes: unknown[];
} {
  const updates: Record<string, unknown>[] = [];
  const messages: { id: string; conversation_id: string; meta: Record<string, unknown> }[] = [];
  const ghlLogs: unknown[] = [];
  const notes: unknown[] = [];
  const convByClient: Record<string, HlConversationRow> = {
    [PRIMARY]: {
      id: "conv-primary",
      hl_contact_id: "hl-primary",
      last_message_at: null,
      client_id: PRIMARY,
      email: "bride@example.com",
    },
    [COCLIENT]: {
      id: "conv-groom",
      hl_contact_id: "hl-groom",
      last_message_at: null,
      client_id: COCLIENT,
      email: "groom@example.com",
    },
  };

  const deps: EmailCommsLogDeps & {
    updates: typeof updates;
    messages: typeof messages;
    ghlLogs: typeof ghlLogs;
    notes: typeof notes;
  } = {
    updates,
    messages,
    ghlLogs,
    notes,
    isHighLevelConfigured: () => true,
    listEventClients: async () => eventClients,
    findConversationByClientId: async (clientId) => convByClient[clientId] ?? null,
    findConversationByEmail: async (email) => {
      const row = Object.values(convByClient).find((c) => c.email === email);
      return row ?? null;
    },
    findEmployeeByEmail: async () => null,
    upsertGhlContact: async () => ({ ok: true, contactId: "hl-groom" }),
    findGhlConversationId: async () => "conv-groom",
    createGhlConversation: async () => "conv-groom",
    upsertHlConversation: async () => {},
    upsertHlMessage: async (row) => {
      messages.push({ id: row.id, conversation_id: row.conversation_id, meta: row.meta });
    },
    updateConversationPreview: async () => {},
    logEmailInGhl: async (opts) => {
      ghlLogs.push(opts);
      return { ok: true, messageId: "ghl-msg-1" };
    },
    leaveGhlNote: async (contactId, body) => {
      notes.push({ contactId, body });
      return { ok: true };
    },
    updateEmailLog: async (_id, patch) => {
      updates.push(patch);
    },
    ...overrides,
  };
  return deps;
}

describe("emailCommsLog helpers", () => {
  it("normalizes and strips html", () => {
    assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
    assert.equal(stripHtmlForComms("<p>Hi<br>there</p>"), "Hi\nthere");
  });

  it("resolves the recipient among event_clients by email, not the primary fallback", () => {
    assert.equal(resolveRecipientClientId("groom@example.com", eventClients, PRIMARY), COCLIENT);
    assert.equal(resolveRecipientClientId("unknown@example.com", eventClients, PRIMARY), PRIMARY);
    assert.equal(resolveRecipientClientId("bride@example.com", eventClients, null), PRIMARY);
  });

  it("builds source labels and mirror ids", () => {
    assert.equal(
      buildSourceLabel({ sourceKind: "booking_helper", templateName: "Payment Received" }),
      "Booking helper: Payment Received",
    );
    assert.equal(buildSourceLabel({ sourceLabel: "Custom" }), "Custom");
    assert.equal(mirrorMessageId(LOG_ID), `xos-email-${LOG_ID}`);
    assert.equal(mirrorMessageId(LOG_ID, COCLIENT), `xos-email-${LOG_ID}-for-${COCLIENT}`);
  });

  it("derives source kind from helper / schedule / reminder flags", () => {
    assert.equal(deriveCommsSource({ helperId: "h1" }), "booking_helper");
    assert.equal(deriveCommsSource({ scheduleEnabled: true }), "scheduled_template");
    assert.equal(deriveCommsSource({ isPaymentReminder: true }), "payment_reminder");
    assert.equal(deriveCommsSource({ bypassCommsPause: true }), "booking_helper");
    assert.equal(deriveCommsSource({}), "manual");
  });
});

describe("recordOutboundEmailComms", () => {
  it("mirrors onto the recipient conversation and fans out to other event clients", async () => {
    const deps = makeDeps();
    const result = await recordOutboundEmailComms(baseInput(), deps);

    assert.equal(result.ok, true);
    assert.equal(result.recipientClientId, COCLIENT);
    assert.equal(result.conversationId, "conv-groom");
    assert.deepEqual(result.mirroredClientIds.sort(), [PRIMARY, COCLIENT].sort());
    assert.equal(result.ghlSyncStatus, "synced");
    assert.equal(result.ghlMessageId, "ghl-msg-1");

    const recipientMsg = deps.messages.find((m) => m.id === `xos-email-${LOG_ID}`);
    assert.ok(recipientMsg);
    assert.equal(recipientMsg!.conversation_id, "conv-groom");
    assert.equal(recipientMsg!.meta.sourceKind, "booking_helper");
    assert.match(String(recipientMsg!.meta.sourceLabel), /Booking helper/);

    const fanout = deps.messages.find((m) => m.id === `xos-email-${LOG_ID}-for-${PRIMARY}`);
    assert.ok(fanout);
    assert.equal(fanout!.conversation_id, "conv-primary");
    assert.equal(fanout!.meta.sharedOnEvent, true);
    assert.match(String(fanout!.meta.sourceLabel), /to Bob Groom/);

    assert.equal(deps.ghlLogs.length, 1);
    assert.equal(deps.notes.length, 0);
    const lastUpdate = deps.updates.at(-1) as { ghl_sync_status?: string; client_id?: string };
    assert.equal(lastUpdate.ghl_sync_status, "synced");
    assert.equal(lastUpdate.client_id, COCLIENT);
  });

  it("records GHL failure without throwing and still writes the Comms mirror", async () => {
    const deps = makeDeps({
      logEmailInGhl: async () => ({ ok: false, error: "503: upstream" }),
    });
    // Default leaveGhlNote still records into deps.notes.
    const result = await recordOutboundEmailComms(baseInput(), deps);

    assert.equal(result.ok, true);
    assert.equal(result.ghlSyncStatus, "failed");
    assert.equal(result.ghlError, "503: upstream");
    assert.ok(deps.messages.some((m) => m.id === `xos-email-${LOG_ID}`));
    assert.equal(deps.notes.length, 1);
    assert.equal(deps.ghlLogs.length, 0);
    const failed = deps.updates.find((u) => (u as { ghl_sync_status?: string }).ghl_sync_status === "failed");
    assert.ok(failed);
    assert.match(String((failed as { ghl_sync_error?: string }).ghl_sync_error), /503/);
  });

  it("skips GHL post when alreadyInGhl but still mirrors locally", async () => {
    const deps = makeDeps();
    const result = await recordOutboundEmailComms(
      baseInput({ alreadyInGhl: true, ghlMessageId: "existing-hl" }),
      deps,
    );
    assert.equal(result.ghlSyncStatus, "synced");
    assert.equal(deps.ghlLogs.length, 0);
    assert.ok(deps.messages.some((m) => m.id === `xos-email-${LOG_ID}`));
  });

  it("does not throw when deps blow up; marks ghl_sync failed", async () => {
    const deps = makeDeps({
      listEventClients: async () => {
        throw new Error("db down");
      },
    });
    const result = await recordOutboundEmailComms(baseInput(), deps);
    assert.equal(result.ok, false);
    assert.equal(result.ghlSyncStatus, "failed");
    assert.match(result.ghlError ?? "", /db down/);
  });
});
