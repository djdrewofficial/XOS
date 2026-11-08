import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addContact,
  coerceMoney,
  onboardingEffects,
  addEventQuestion,
  addEventSection,
  addTemplateQuestion,
  addTemplateSection,
  helperVisibilityPatch,
  inviteEffect,
  removeContact,
  documentBlocks,
  helperButtonPatch,
  saveArticle,
  saveBackdrop,
  saveBriefingPref,
  saveDocumentBlocks,
  saveHelperButton,
  saveHelperVisibility,
  saveWeekdayPrices,
  saveTemplateSchedule,
  spotifyExistingConnection,
  templateSchedulePatch,
  updateEventQuestion,
  updateEventSection,
  updateTemplateQuestion,
  type EditorDb,
  type EditorQuery,
} from "./officeEdits.ts";

type Row = Record<string, unknown>;

function memoryDb(seed: Record<string, Row[]> = {}): { db: EditorDb; tables: Record<string, Row[]> } {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const ensure = (table: string) => (tables[table] ??= []);

  function query(table: string, mode: "select" | "insert" | "update" | "delete", payload?: Row | Row[]): EditorQuery {
    const filters: { op: string; column: string; value: unknown }[] = [];
    let orderBy: { column: string; ascending: boolean } | null = null;
    let max: number | null = null;
    const match = (row: Row) => filters.every((filter) => {
      if (filter.op === "eq") return row[filter.column] === filter.value;
      if (filter.op === "gte") return Number(row[filter.column]) >= Number(filter.value);
      if (filter.op === "in") return (filter.value as unknown[]).includes(row[filter.column]);
      if (filter.op === "neq") return row[filter.column] !== filter.value;
      return true;
    });
    const run = (): { data: unknown; error: { message: string } | null } => {
      const rows = ensure(table);
      if (mode === "insert") {
        const incoming = Array.isArray(payload) ? payload : [payload as Row];
        const stored = incoming.map((item) => ({ id: item.id ?? crypto.randomUUID(), ...item }));
        rows.push(...stored);
        return { data: stored.length === 1 ? stored[0] : stored, error: null };
      }
      let found = rows.filter(match);
      if (orderBy) {
        found = [...found].sort((a, b) => {
          const delta = Number(a[orderBy!.column]) - Number(b[orderBy!.column]);
          return orderBy!.ascending ? delta : -delta;
        });
      }
      if (max != null) found = found.slice(0, max);
      if (mode === "update") {
        for (const item of found) Object.assign(item, payload);
        return { data: found, error: null };
      }
      if (mode === "delete") {
        tables[table] = rows.filter((item) => !found.includes(item));
        return { data: found, error: null };
      }
      return { data: found, error: null };
    };
    const api = {
      eq(column: string, value: unknown) { filters.push({ op: "eq", column, value }); return api; },
      in(column: string, value: unknown[]) { filters.push({ op: "in", column, value }); return api; },
      gte(column: string, value: unknown) { filters.push({ op: "gte", column, value }); return api; },
      neq(column: string, value: unknown) { filters.push({ op: "neq", column, value }); return api; },
      order(column: string, opts?: { ascending?: boolean }) { orderBy = { column, ascending: opts?.ascending !== false }; return api; },
      limit(n: number) { max = n; return api; },
      select() { return api; },
      maybeSingle: async () => ({ data: (run().data as Row[])[0] ?? null, error: null }),
      single: async () => ({ data: run().data, error: null }),
      then(resolve: (value: { data: unknown; error: null }) => void, reject?: (err: unknown) => void) {
        try { resolve({ data: run().data, error: null }); } catch (err) { reject?.(err); }
      },
    };
    return api as EditorQuery;
  }

  return {
    tables,
    db: {
      from(table: string) {
        return {
          select: () => query(table, "select"),
          insert: (row: Row | Row[]) => query(table, "insert", row),
          update: (patch: Row) => query(table, "update", patch),
          delete: () => query(table, "delete"),
        };
      },
    },
  };
}

const TYPE = "11111111-1111-4111-8111-111111111111";
const STATUS = "22222222-2222-4222-8222-222222222222";

describe("helper visibility", () => {
  it("stores an empty list for all and rejects an empty only-list", () => {
    const all = helperVisibilityPatch({ mode_event_type: "all", mode_roles: "all", required_fields: ["event_date", "client_email"] });
    assert.deepEqual(all.visible_event_type_ids, []);
    assert.deepEqual(all.allowed_roles, []);
    assert.deepEqual(all.required_fields, ["event_date", "client_email"]);
    assert.throws(() => helperVisibilityPatch({ mode_event_type: "only", visible_event_type_ids: [] }), /at least one/);
    assert.throws(() => helperVisibilityPatch({ mode_roles: "only", allowed_roles: ["master_admin"] }), /Master Admin/);
  });

  it("writes the full visibility block", async () => {
    const { db, tables } = memoryDb({ booking_helpers: [{ id: "h1", visible_event_type_ids: ["old"] }] });
    const patch = await saveHelperVisibility(db, "h1", {
      mode_event_type: "only",
      visible_event_type_ids: [TYPE],
      hide_if_payment_made: true,
      auto_on_payment: true,
    });
    assert.deepEqual(tables.booking_helpers[0].visible_event_type_ids, [TYPE]);
    assert.equal(tables.booking_helpers[0].hide_if_payment_made, true);
    assert.equal(patch.auto_on_payment, true);
    assert.deepEqual(patch.allowed_roles, []);
  });
});

describe("template schedule", () => {
  it("uses the form defaults and selected-package mode", () => {
    const patch = templateSchedulePatch({
      schedule_enabled: true,
      schedule_days: 3,
      schedule_direction: "after",
      schedule_anchor: "booked_date",
      sched_package_ids: [TYPE],
      sched_send_to: ["primary_client", "venue"],
      sched_payments: "partial",
    });
    assert.equal(patch.schedule_direction, "after");
    assert.equal(patch.sched_packages_mode, "selected");
    assert.equal(patch.sched_payments, "partial");
    assert.equal(patch.schedule_send_time, "09:00");
    assert.equal(patch.employee_visibility, "admins_salespeople");
    assert.throws(() => templateSchedulePatch({ schedule_anchor: "birthday" }), /Schedule anchor/);
    assert.throws(() => templateSchedulePatch({ sched_send_to: ["everyone"] }), /Send to/);
  });

  it("replaces the schedule columns and clears review flags", async () => {
    const { db, tables } = memoryDb({ email_templates: [{ id: "t1", schedule_days: 9, review_reasons: ["old"] }] });
    await saveTemplateSchedule(db, "t1", { schedule_enabled: true, schedule_days: 1, mode_status: "only", sched_status_ids: [STATUS] });
    assert.equal(tables.email_templates[0].schedule_days, 1);
    assert.deepEqual(tables.email_templates[0].sched_status_ids, [STATUS]);
    assert.deepEqual(tables.email_templates[0].review_reasons, []);
  });
});

describe("planner questions and event sections", () => {
  it("adds a template question only on that template and clears options for short text", async () => {
    const { db, tables } = memoryDb({
      planning_template_sections: [{ id: "s1", template_id: "tpl", sort_order: 0 }],
      planning_template_questions: [],
    });
    await addTemplateQuestion(db, "tpl", "s1", { prompt: "Song vibe", answer_type: "short", options: ["nope"] });
    assert.equal(tables.planning_template_questions[0].prompt, "Song vibe");
    assert.deepEqual(tables.planning_template_questions[0].options, []);
    assert.equal(tables.planning_template_questions[0].sort_order, 0);
    await assert.rejects(() => addTemplateQuestion(db, "other", "s1", { prompt: "x", answer_type: "short" }), /not on this planner template/);
    await assert.rejects(() => addTemplateQuestion(db, "tpl", "s1", { prompt: "Pick", answer_type: "select", options: [] }), /at least one option/);
  });

  it("does not wipe photo options when an update omits them", async () => {
    const { db, tables } = memoryDb({
      planning_template_sections: [{ id: "s1", template_id: "tpl" }],
      planning_template_questions: [{ id: "q1", template_section_id: "s1", answer_type: "image_select", options: [{ label: "Gold", image: "a" }], prompt: "Look" }],
    });
    await updateTemplateQuestion(db, "tpl", "q1", { prompt: "Look updated" });
    assert.equal(tables.planning_template_questions[0].prompt, "Look updated");
    assert.deepEqual(tables.planning_template_questions[0].options, [{ label: "Gold", image: "a" }]);
  });

  it("names a new template section the way the builder does", async () => {
    const { db, tables } = memoryDb({ planning_template_sections: [{ id: "s0", template_id: "tpl", sort_order: 2 }] });
    const created = await addTemplateSection(db, "tpl", { section_type: "headline" });
    assert.equal(created.title, "New Chapter");
    assert.equal(tables.planning_template_sections[1].songs_enabled, false);
    assert.equal(tables.planning_template_sections[1].sort_order, 3);
  });

  it("shifts later event sections and refuses a question on another event", async () => {
    const { db, tables } = memoryDb({
      planning_sections: [
        { id: "a", event_id: "e1", sort_order: 0 },
        { id: "b", event_id: "e1", sort_order: 1 },
      ],
      planning_questions: [],
    });
    const created = await addEventSection(db, "e1", { title: "Dinner", after_sort_order: 0 });
    assert.equal(created.sort_order, 1);
    assert.equal(tables.planning_sections.find((item) => item.id === "b")?.sort_order, 2);
    await updateEventSection(db, "e1", "a", { songs_enabled: false, song_limit: 4 });
    assert.equal(tables.planning_sections.find((item) => item.id === "a")?.song_limit, 4);
    await addEventQuestion(db, "e1", "a", { prompt: "Entrée", answer_type: "select", options: ["Fish", "Chicken"] });
    assert.equal(tables.planning_questions[0].event_id, "e1");
    await assert.rejects(() => updateEventQuestion(db, "e2", tables.planning_questions[0].id as string, { prompt: "Nope" }), /not on this event/);
  });
});

describe("venue and vendor contacts", () => {
  it("requires a name and deletes only the parent row", async () => {
    const { db, tables } = memoryDb({
      venue_contacts: [{ id: "c1", venue_id: "v1", name: "Alex" }, { id: "c2", venue_id: "v2", name: "Blair" }],
      vendor_contacts: [],
    });
    await assert.rejects(() => addContact(db, "venue_contacts", "venue_id", "v1", { name: "  " }), /name/);
    await addContact(db, "vendor_contacts", "vendor_id", "ven", { name: "Sam", email: "sam@example.com", phone: "305" });
    assert.equal(tables.vendor_contacts[0].email, "sam@example.com");
    await assert.rejects(() => removeContact(db, "venue_contacts", "venue_id", "v1", "c2"), /not on this record/);
    await removeContact(db, "venue_contacts", "venue_id", "v1", "c1");
    assert.equal(tables.venue_contacts.length, 1);
    assert.equal(tables.venue_contacts[0].id, "c2");
  });
});

describe("remaining editors", () => {
  it("saves weekday prices, helper buttons, document blocks, backdrops, briefings, and articles", async () => {
    const { db, tables } = memoryDb({
      packages: [{ id: "p1" }],
      booking_helpers: [{ id: "h1" }],
      document_templates: [{ id: "d1" }],
      photobooth_backdrops: [],
      staff_briefing_prefs: [{ employee_id: "e1", enabled: false }],
      kb_articles: [],
    });
    await saveWeekdayPrices(db, "p1", { weekday_0: "100", weekday_5: 250, weekday_1: "" });
    assert.deepEqual(tables.packages[0].weekday_prices, { "0": 100, "5": 250 });
    await saveHelperButton(db, "h1", { button_text: "Book", button_bg: "#112233", button_fg: "#abcdef", button_font_size: 18, button_font_weight: 700 });
    assert.equal(tables.booking_helpers[0].button_font_weight, 700);
    const blockId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await saveDocumentBlocks(db, "d1", [{ id: blockId, type: "section", title: "Terms", html: "<p>Hi</p>" }, { type: "fee_table" }]);
    assert.equal((tables.document_templates[0].blocks as { type: string }[])[1].type, "fee_table");
    await saveBackdrop(db, null, { name: "Gold", category: "Wedding" });
    assert.equal(tables.photobooth_backdrops[0].name, "Gold");
    await saveBriefingPref(db, "e1", { enabled: true, frequency: "weekdays" });
    assert.equal(tables.staff_briefing_prefs[0].frequency, "weekdays");
    await saveArticle(db, null, { title: "Payments", content: "How to record one." });
    assert.equal(tables.kb_articles[0].title, "Payments");
    assert.throws(() => helperButtonPatch({ button_text: "X", button_bg: "red", button_fg: "#000000" }), /#RRGGBB/);
    assert.throws(() => documentBlocks([{ type: "video" }]), /unknown type/);
  });
});

describe("onboarding money normalization", () => {
  it("treats a numeric string wage as payroll and a new venue as a venue write", () => {
    const effect = onboardingEffects({
      staff: [{ flat_wage: "150" }],
      newVenue: { name: "Hall" },
      packagePriceOverride: "2450",
    });
    assert.equal(effect.staff[0].flat_wage, 150);
    assert.ok(effect.scopes.includes("money.payroll"));
    assert.ok(effect.scopes.includes("write.venues"));
    assert.ok(effect.scopes.includes("money"));
    assert.throws(() => coerceMoney("nope", "Wage"), /number/);
  });
});

describe("invite effect", () => {
  it("freezes the address and hides the set-password link", () => {
    const effect = inviteEffect({ email: "Ada@Example.com", templateBody: "Go <set_password_link> now" });
    assert.equal(effect.to, "ada@example.com");
    assert.equal(effect.body.includes("set_password_link"), false);
    assert.match(effect.body, /\[set password link\]/);
  });
});

describe("spotify without a new login", () => {
  it("uses a stored connection and refuses to start one", () => {
    assert.deepEqual(spotifyExistingConnection({ connected: false }), { ok: false, reason: "needs_connect" });
    assert.deepEqual(spotifyExistingConnection({ connected: true, canWrite: false }), { ok: false, reason: "needs_reconnect" });
    assert.deepEqual(spotifyExistingConnection({ connected: true, canWrite: true }), { ok: true });
  });
});
