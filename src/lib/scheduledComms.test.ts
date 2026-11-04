import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  addDays,
  buildScheduledComms,
  mapTemplate,
  targetDateFor,
  templateMatchesEvent,
  type RecipientDirectory,
  type ScheduleEventFacts,
  type ScheduleRun,
  type ScheduleTemplate,
  type TemplateRow,
} from "./scheduledComms.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const NOW = new Date("2026-11-04T15:00:00Z"); // 10:00 AM America/New_York
const TZ = "America/New_York";

function template(partial: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    id: "tpl-1",
    name: "We're Alive",
    displayName: "We're Alive",
    isSms: false,
    subject: "Hello <first_name>",
    bodyHtml: "<p>See you <event_date_long></p>",
    isRawHtml: false,
    scheduleDays: 30,
    scheduleDirection: "before",
    scheduleAnchor: "event_date",
    scheduleSendTime: "09:00:00",
    schedStatusIds: [],
    schedEventTypeIds: [],
    schedPackagesMode: "all",
    schedPackageIds: [],
    schedAddonsMode: "all",
    schedAddonIds: [],
    schedPayments: "any",
    schedSalespersonMode: "any",
    schedSalespersonIds: [],
    schedEmployeeMode: "any",
    schedEmployeeIds: [],
    schedSendTo: ["primary_client"],
    schedExcludeDeclined: false,
    schedAlsoSendTo: null,
    schedVendorCategoryIds: [],
    ...partial,
  };
}

function facts(partial: Partial<ScheduleEventFacts> = {}): ScheduleEventFacts {
  return {
    eventDate: "2026-12-05",
    bookedDate: null,
    initialContactDate: null,
    contractSentDate: null,
    contractDueDate: null,
    contractSignedDate: null,
    quoteSentDate: null,
    statusId: "booked",
    eventTypeId: "wedding",
    packageId: "pkg",
    salespersonId: "sales",
    addonIds: [],
    schedulerTotal: 1000,
    paymentsSum: 0,
    staffEmployeeIds: [],
    ...partial,
  };
}

function directory(): RecipientDirectory {
  return {
    primary: { name: "Lea Durst", email: "lea@example.com", phone: "954-555-0101" },
    additional: [{ name: "Jozsef Durst", email: "jozsef@example.com", phone: "954-555-0102" }],
    venue: { name: "Villa Toscana", email: "villa@example.com", phone: "954-555-0199" },
    vendors: [],
    salesperson: { name: "Drew", email: "drew@xpressdjs.com", phone: "954-555-0001" },
    staff: [
      {
        staffId: "b",
        name: "Alex",
        email: "alex@xpressdjs.com",
        phone: "954-555-0002",
        role: "Photo",
        declinedAt: null,
        confirmedAt: "2026-10-01",
      },
      {
        staffId: "a",
        name: "Sam",
        email: "sam@xpressdjs.com",
        phone: "954-555-0003",
        role: "DJ",
        declinedAt: null,
        confirmedAt: null,
      },
    ],
    masterAdminEmail: "events@xpressdjs.com",
    masterAdmins: [{ name: "Drew", email: "drew@xpressdjs.com", phone: "954-555-0001" }],
  };
}

function list(partial: {
  templates?: ScheduleTemplate[];
  event?: Partial<ScheduleEventFacts>;
  runs?: ScheduleRun[];
  directory?: RecipientDirectory;
  commsPaused?: boolean;
  historyTemplates?: ScheduleTemplate[];
}) {
  return buildScheduledComms({
    templates: partial.templates ?? [template()],
    historyTemplates: partial.historyTemplates,
    event: facts(partial.event),
    runs: partial.runs ?? [],
    directory: partial.directory ?? directory(),
    commsPaused: partial.commsPaused ?? false,
    timeZone: TZ,
    now: NOW,
  });
}

describe("target date", () => {
  it("counts days before and after the anchor, including same-day", () => {
    assert.equal(targetDateFor(template({ scheduleDays: 30, scheduleDirection: "before" }), facts()), "2026-11-05");
    assert.equal(targetDateFor(template({ scheduleDays: 2, scheduleDirection: "after" }), facts()), "2026-12-07");
    assert.equal(targetDateFor(template({ scheduleDays: 0 }), facts()), "2026-12-05");
  });

  it("uses the named anchor and skips a template when that date is empty", () => {
    const dates = facts({ bookedDate: "2026-06-01" });
    assert.equal(targetDateFor(template({ scheduleAnchor: "booked_date", scheduleDays: 0 }), dates), "2026-06-01");
    assert.equal(targetDateFor(template({ scheduleAnchor: "quote_sent_date" }), facts()), null);
    assert.equal(targetDateFor(template({ scheduleAnchor: "anything-else", scheduleDays: 0 }), facts()), "2026-12-05");
  });

  it("adds days on the calendar, not the clock", () => {
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });
});

describe("template match gates", () => {
  const event = facts();

  it("treats an empty status or event-type list as any", () => {
    assert.equal(templateMatchesEvent(template(), event), true);
  });

  it("requires the event status and type when the template lists them", () => {
    assert.equal(templateMatchesEvent(template({ schedStatusIds: ["lead"] }), event), false);
    assert.equal(templateMatchesEvent(template({ schedStatusIds: ["booked"] }), event), true);
    assert.equal(templateMatchesEvent(template({ schedEventTypeIds: ["quince"] }), event), false);
    assert.equal(templateMatchesEvent(template({ schedEventTypeIds: ["wedding"] }), event), true);
  });

  it("filters package, addon, salesperson, and employee the way the scheduler does", () => {
    assert.equal(templateMatchesEvent(template({ schedPackagesMode: "selected", schedPackageIds: ["other"] }), event), false);
    assert.equal(
      templateMatchesEvent(template({ schedAddonsMode: "assigned", schedAddonIds: ["led"] }), facts({ addonIds: ["uplight"] })),
      false,
    );
    assert.equal(
      templateMatchesEvent(template({ schedAddonsMode: "not_assigned", schedAddonIds: ["led"] }), facts({ addonIds: ["led"] })),
      false,
    );
    assert.equal(
      templateMatchesEvent(template({ schedSalespersonMode: "selected", schedSalespersonIds: ["other"] }), event),
      false,
    );
    assert.equal(
      templateMatchesEvent(template({ schedEmployeeMode: "selected", schedEmployeeIds: ["dj"] }), facts({ staffEmployeeIds: ["photo"] })),
      false,
    );
  });

  it("compares payments with the scheduler's total, including a zero-dollar paid-in-full", () => {
    assert.equal(templateMatchesEvent(template({ schedPayments: "none" }), facts({ paymentsSum: 10 })), false);
    assert.equal(templateMatchesEvent(template({ schedPayments: "partial" }), facts({ paymentsSum: 10, schedulerTotal: 100 })), true);
    assert.equal(templateMatchesEvent(template({ schedPayments: "partial" }), facts({ paymentsSum: 0, schedulerTotal: 100 })), false);
    assert.equal(templateMatchesEvent(template({ schedPayments: "paid_full" }), facts({ paymentsSum: 100, schedulerTotal: 100 })), true);
    assert.equal(templateMatchesEvent(template({ schedPayments: "paid_full" }), facts({ paymentsSum: 0, schedulerTotal: 0 })), true);
    assert.equal(templateMatchesEvent(template({ schedPayments: "paid_full" }), facts({ paymentsSum: 40, schedulerTotal: 100 })), false);
  });
});

describe("the comms list", () => {
  it("lists a future match with the client, the send clock, and skip/edit/mark actions", () => {
    const [item] = list({});
    assert.equal(item.templateName, "We're Alive");
    assert.equal(item.channel, "email");
    assert.equal(item.targetDate, "2026-11-05");
    assert.equal(item.section, "upcoming");
    assert.equal(item.state, "upcoming");
    assert.equal(item.stateLabel, "Scheduled");
    assert.match(item.whenLabel, /Tomorrow/);
    assert.match(item.whenLabel, /9:00 AM/);
    assert.equal(item.recipientSummary, "Primary client · Lea Durst · lea@example.com");
    assert.equal(item.canSkip, true);
    assert.equal(item.canEdit, true);
    assert.equal(item.canMarkSent, true);
    assert.equal(item.canUndoSkip, false);
    assert.equal(item.subject, "Hello <first_name>");
    assert.match(item.bodyHtml, /event_date_long/);
  });

  it("calls a send due once today's send time has passed", () => {
    const [item] = list({
      templates: [template({ scheduleDays: 31 })],
    });
    assert.equal(item.targetDate, "2026-11-04");
    assert.equal(item.state, "due");
    assert.equal(item.canSkip, true);
  });

  it("keeps today's send scheduled when the clock has not reached the send time", () => {
    const [item] = list({
      templates: [template({ scheduleDays: 31, scheduleSendTime: "18:30:00" })],
    });
    assert.equal(item.state, "upcoming");
    assert.match(item.whenLabel, /6:30 PM/);
  });

  it("shows sent, skipped, and marked-sent runs, and only lets a future skip be undone", () => {
    const sent = list({
      runs: [
        {
          templateId: "tpl-1",
          targetDate: "2026-11-05",
          status: "sent",
          sentAt: "2026-11-05T14:00:00Z",
          actedByName: null,
          actedAt: null,
          overrideSubject: null,
          overrideBodyHtml: null,
          overrideIsRawHtml: null,
          editedByName: null,
          editedAt: null,
        },
      ],
    })[0];
    assert.equal(sent.state, "sent");
    assert.equal(sent.canSkip, false);
    assert.equal(sent.canEdit, false);
    assert.equal(sent.canMarkSent, false);
    assert.match(sent.auditLines[0], /Sent/);

    const skipped = list({
      runs: [
        {
          templateId: "tpl-1",
          targetDate: "2026-11-05",
          status: "skipped",
          sentAt: null,
          actedByName: "Laura Del Gordo",
          actedAt: "2026-11-03T18:00:00Z",
          overrideSubject: null,
          overrideBodyHtml: null,
          overrideIsRawHtml: null,
          editedByName: null,
          editedAt: null,
        },
      ],
    })[0];
    assert.equal(skipped.state, "skipped");
    assert.equal(skipped.canUndoSkip, true);
    assert.equal(skipped.canSkip, false);
    assert.equal(skipped.canEdit, true);
    assert.match(skipped.auditLines[0], /Laura Del Gordo/);

    const marked = list({
      runs: [
        {
          templateId: "tpl-1",
          targetDate: "2026-11-05",
          status: "marked_sent",
          sentAt: null,
          actedByName: "Drew",
          actedAt: "2026-11-02T15:00:00Z",
          overrideSubject: null,
          overrideBodyHtml: null,
          overrideIsRawHtml: null,
          editedByName: null,
          editedAt: null,
        },
      ],
    })[0];
    assert.equal(marked.state, "marked_sent");
    assert.equal(marked.canMarkSent, false);
    assert.equal(marked.canUndoSkip, false);
    assert.match(marked.auditLines[0], /Drew/);
  });

  it("uses the per-event subject and body when an edit is waiting", () => {
    const [item] = list({
      runs: [
        {
          templateId: "tpl-1",
          targetDate: "2026-11-05",
          status: "pending",
          sentAt: null,
          actedByName: null,
          actedAt: null,
          overrideSubject: "Custom subject <first_name>",
          overrideBodyHtml: "<p>Custom <event_date_long></p>",
          overrideIsRawHtml: true,
          editedByName: "Drew",
          editedAt: "2026-11-04T14:00:00Z",
        },
      ],
    });
    assert.equal(item.edited, true);
    assert.equal(item.canRevert, true);
    assert.equal(item.subject, "Custom subject <first_name>");
    assert.match(item.bodyHtml, /Custom/);
    assert.equal(item.isRawHtml, true);
    assert.equal(item.state, "upcoming");
    assert.match(item.auditLines[0], /Edited for this event by Drew/);
  });

  it("labels a past day with no run as not sent, and still allows mark-as-sent", () => {
    const [item] = list({ templates: [template({ scheduleDays: 40 })] });
    assert.equal(item.targetDate, "2026-10-26");
    assert.equal(item.section, "recent");
    assert.equal(item.state, "not_sent");
    assert.equal(item.canMarkSent, true);
    assert.equal(item.canSkip, false);
    assert.equal(item.canEdit, false);
  });

  it("hides matches older than the recent window, but keeps a run inside it", () => {
    const old = list({ templates: [template({ scheduleDays: 140 })] });
    assert.equal(old.length, 0);

    const kept = list({
      templates: [template({ id: "old", scheduleDays: 40 })],
      runs: [
        {
          templateId: "old",
          targetDate: "2026-10-26",
          status: "sent",
          sentAt: "2026-10-26T13:00:00Z",
          actedByName: null,
          actedAt: null,
          overrideSubject: null,
          overrideBodyHtml: null,
          overrideIsRawHtml: null,
          editedByName: null,
          editedAt: null,
        },
      ],
    });
    assert.equal(kept.length, 1);
    assert.equal(kept[0].state, "sent");
  });

  it("shows a past send even after the template stops matching, without inventing a new one", () => {
    const retired = template({ id: "retired", schedStatusIds: ["lead"] });
    const items = list({
      templates: [],
      historyTemplates: [retired],
      runs: [
        {
          templateId: "retired",
          targetDate: "2026-10-20",
          status: "sent",
          sentAt: "2026-10-20T13:00:00Z",
          actedByName: null,
          actedAt: null,
          overrideSubject: null,
          overrideBodyHtml: null,
          overrideIsRawHtml: null,
          editedByName: null,
          editedAt: null,
        },
      ],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].state, "sent");
    assert.equal(items[0].canEdit, false);
  });

  it("does not list a template the event fails", () => {
    assert.equal(list({ templates: [template({ schedStatusIds: ["lead"] })] }).length, 0);
  });

  it("names every audience, prefers the DJ as the primary employee, and warns when a contact is missing", () => {
    const [item] = list({
      templates: [
        template({
          isSms: true,
          schedSendTo: ["primary_client", "additional_clients", "primary_employee", "unconfirmed_employees"],
        }),
      ],
      directory: {
        ...directory(),
        primary: { name: "Lea Durst", email: "lea@example.com", phone: null },
      },
    });
    assert.equal(item.channel, "sms");
    assert.match(item.recipientSummary, /Primary client · Lea Durst \(nothing on file\)/);
    assert.match(item.recipientSummary, /Additional client · Jozsef Durst · 954-555-0102/);
    assert.match(item.recipientSummary, /Primary employee · Sam · 954-555-0003/);
    assert.doesNotMatch(item.recipientSummary, /Alex/);
  });

  it("drops declined staff when the template says to, and lists only unconfirmed staff for that audience", () => {
    const dir = directory();
    dir.staff[1].declinedAt = "2026-10-02";
    const [all] = list({
      templates: [template({ schedSendTo: ["all_employees"], schedExcludeDeclined: true })],
      directory: dir,
    });
    assert.match(all.recipientSummary, /Assigned employee · Alex · alex@xpressdjs.com/);
    assert.doesNotMatch(all.recipientSummary, /sam@xpressdjs.com/);

    const [open] = list({
      templates: [template({ schedSendTo: ["unconfirmed_employees"] })],
      directory: directory(),
    });
    assert.match(open.recipientSummary, /Unconfirmed employee · Sam · sam@xpressdjs.com/);
    assert.doesNotMatch(open.recipientSummary, /alex@xpressdjs.com/);
  });

  it("says the message is held when automated comms are paused", () => {
    const [email] = list({ commsPaused: true });
    assert.match(email.pauseNote ?? "", /won't send while automated comms are paused/i);

    const [text] = list({
      commsPaused: true,
      templates: [template({ isSms: true, schedSendTo: ["primary_client"] })],
    });
    assert.match(text.pauseNote ?? "", /Client texts/);

    const [staffOnly] = list({
      commsPaused: true,
      templates: [template({ isSms: true, schedSendTo: ["salesperson"] })],
    });
    assert.equal(staffOnly.pauseNote, null);

    const [already] = list({
      commsPaused: true,
      runs: [
        {
          templateId: "tpl-1",
          targetDate: "2026-11-05",
          status: "sent",
          sentAt: "2026-11-05T14:00:00Z",
          actedByName: null,
          actedAt: null,
          overrideSubject: null,
          overrideBodyHtml: null,
          overrideIsRawHtml: null,
          editedByName: null,
          editedAt: null,
        },
      ],
    });
    assert.equal(already.pauseNote, null);
  });
});

describe("row mapping", () => {
  it("ignores a template with no day count", () => {
    const row = { id: "x", schedule_days: null } as TemplateRow;
    assert.equal(mapTemplate(row), null);
  });
});

describe("scheduler SQL", () => {
  const sql = readFileSync(join(root, "supabase/migrations/00206_scheduled_comm_controls.sql"), "utf8");

  it("keeps the lock, the holiday window, and the helper failure log", () => {
    assert.match(sql, /pg_advisory_xact_lock\(4771001\)/);
    assert.match(sql, /email_blackout_dates/);
    assert.match(sql, /email_send_window_start/);
    assert.match(sql, /Scheduled helper did not run/);
  });

  it("does not queue a skipped, sent, or marked-sent occurrence", () => {
    assert.match(sql, /v_run_status in \('sent', 'skipped', 'marked_sent'\)/);
    assert.match(sql, /if found and v_run_status in \('sent', 'skipped', 'marked_sent'\) then\s+continue;/);
  });

  it("sends the per-event override through the same merge-tag renderer and keeps template_id on the email", () => {
    assert.match(sql, /render_merge_tags\(e\.id, coalesce\(v_override_subject, t\.subject\)\)/);
    assert.match(sql, /render_merge_tags\(e\.id, coalesce\(v_override_body, t\.body_html\)\)/);
    assert.match(sql, /insert into email_log \(event_id, client_id, template_id,/);
    assert.match(sql, /where scheduled_email_runs\.status = 'pending'/);
  });

  it("queues an SMS template as a text after merge tags are filled", () => {
    assert.match(sql, /xos_html_to_sms\(render_merge_tags\(e\.id, coalesce\(v_override_body, t\.body_html\)\)\)/);
    assert.match(sql, /insert into sms_log \(event_id, client_id, to_number, body, status, is_marketing\)/);
    assert.match(sql, /coalesce\(t\.is_sms, false\)/);
  });

  it("records who acted, and does not hand the function back to signed-in clients", () => {
    assert.match(sql, /acted_by uuid/);
    assert.match(sql, /acted_at timestamptz/);
    assert.match(sql, /edited_by uuid/);
    assert.match(sql, /status in \('pending', 'sent', 'skipped', 'marked_sent'\)/);
    assert.doesNotMatch(sql, /grant execute on function public\.run_scheduled_emails/);
  });
});
