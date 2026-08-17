/* Tasks Manager engine — the shared evaluator that turns task_rules into tasks.
   Run two ways: daily via pg_cron (/api/cron/task-rules) and on-demand from the
   "Run rules now" button (a server action). Conditions are evaluated here in TS
   (not SQL) so the vocabulary below is the single source of truth for the engine,
   the manual rule builder UI, and the AI rule author's whitelist.

   Dedupe: every generated task carries dedupe_key = `rule:<ruleId>:event:<eventId>`
   with a unique index, so a rule creates at most one task per event, ever. */

import type { SupabaseClient } from "@supabase/supabase-js";

// ---- Vocabulary (shared with the UI + the AI prompt) ----------------------

export const TRIGGER_ANCHORS = [
  { value: "event_date", label: "Event date" },
  { value: "booked_date", label: "Date booked" },
  { value: "contract_due_date", label: "Contract due date" },
  { value: "created_at", label: "Event created date" },
  { value: "none", label: "No date — check upcoming events daily" },
] as const;

export const ASSIGNEE_TYPES = [
  { value: "unassigned", label: "Unassigned" },
  { value: "staff", label: "A specific staff member" },
  { value: "department", label: "A department" },
  { value: "event_poc", label: "The event's point of contact" },
  { value: "event_salesperson", label: "The event's salesperson" },
  { value: "event_dj", label: "The event's assigned DJ" },
] as const;

/** Staff "departments" = employees.staff_category. */
export const DEPARTMENTS = [
  "Administrators",
  "Salespeople",
  "Production",
  "Subcontractors",
  "Live Musicians",
] as const;

export type ConditionOp = "is" | "is_not" | "is_true" | "is_false";
export type Condition = { field: string; op: ConditionOp; value?: string | null };

/** kind drives which operators + value input the builder/AI use.
    enum options marked `dynamic` are loaded from the DB at runtime. */
export const CONDITION_FIELDS: Array<{
  field: string;
  label: string;
  kind: "boolean" | "enum" | "dynamic_enum";
  source?: "event_types" | "journey_types" | "statuses" | "venues";
  options?: readonly string[];
  help?: string;
}> = [
  { field: "event_type", label: "Event type", kind: "dynamic_enum", source: "event_types" },
  { field: "journey_type", label: "Client journey", kind: "dynamic_enum", source: "journey_types", help: "e.g. Villa Toscana / venue partner" },
  { field: "status", label: "Event status", kind: "dynamic_enum", source: "statuses" },
  { field: "status_group", label: "Pipeline stage", kind: "enum", options: ["leads", "pending", "booked", "lost"] },
  { field: "venue", label: "Venue", kind: "dynamic_enum", source: "venues" },
  { field: "dj_assigned", label: "DJ assigned", kind: "boolean" },
  { field: "salesperson_assigned", label: "Salesperson assigned", kind: "boolean" },
  { field: "poc_assigned", label: "Point of contact assigned", kind: "boolean" },
  { field: "planning_seeded", label: "Planner started", kind: "boolean" },
  { field: "has_vibo_link", label: "Timeline (Vibo) link present", kind: "boolean" },
  { field: "call_booked", label: "Onboarding call booked", kind: "boolean", help: "reads custom_fields.call_booked — needs the HighLevel booking webhook to populate it" },
];

const CONDITION_FIELD_SET = new Set(CONDITION_FIELDS.map((f) => f.field));
export function isConditionField(f: string): boolean {
  return CONDITION_FIELD_SET.has(f);
}

// ---- Date helpers (company timezone: America/New_York) ---------------------

const TZ = "America/New_York";
const DAY_MS = 86_400_000;

/** Today as an epoch-day count in the company timezone. */
function todayEpochDay(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return isoToEpochDay(parts); // en-CA → YYYY-MM-DD
}

/** 'YYYY-MM-DD' → integer day index (days since epoch, tz-agnostic midnight). */
function isoToEpochDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** A timestamptz → the epoch-day of its calendar date in the company tz. */
function tsToEpochDay(ts: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
  return isoToEpochDay(parts);
}

/** epoch-day → 'YYYY-MM-DD' for storing a due_date. */
function epochDayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** epoch-day → 'M/D/YYYY' for human labels (matches the Notion style). */
function epochDayToUS(day: number): string {
  const dt = new Date(day * DAY_MS);
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}/${dt.getUTCFullYear()}`;
}

// ---- Internal event context ----------------------------------------------

type EvalEvent = {
  id: string;
  event_number: number | null;
  event_day: number | null; // event_date as epoch-day
  booked_day: number | null;
  contract_due_day: number | null;
  created_day: number | null;
  client_id: string | null;
  custom_fields: Record<string, unknown>;
  planning_seeded: boolean;
  salesperson_id: string | null;
  poc_employee_id: string | null;
  event_type_name: string | null;
  journey_type_name: string | null;
  status_name: string | null;
  status_group: "leads" | "pending" | "booked" | "lost" | null;
  venue_name: string | null;
  dj_assigned: boolean;
  dj_employee_id: string | null;
  dj_name: string | null;
  client_names: string;
};

type RuleRow = {
  id: string;
  is_active: boolean;
  trigger_anchor: string;
  offset_days: number;
  horizon_days: number | null;
  conditions: Condition[] | null;
  condition_logic: string;
  task_title: string;
  task_body: string | null;
  task_priority: string;
  assignee_type: string;
  assignee_employee_id: string | null;
  assignee_department: string | null;
  due_offset_days: number;
  due_anchor: string | null;
};

// ---- Condition evaluation -------------------------------------------------

function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") return ["true", "yes", "1", "booked", "y"].includes(v.trim().toLowerCase());
  if (typeof v === "number") return v !== 0;
  return false;
}
const eqi = (a: string | null, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

function boolOp(actual: boolean, op: ConditionOp): boolean {
  if (op === "is_true") return actual === true;
  if (op === "is_false") return actual === false;
  return true; // wrong operator for a boolean field → don't block
}

function evalCondition(cond: Condition, ev: EvalEvent): boolean {
  const cmp = (actual: string | null) => (cond.op === "is_not" ? !eqi(actual, cond.value) : eqi(actual, cond.value));
  switch (cond.field) {
    case "event_type": return cmp(ev.event_type_name);
    case "journey_type": return cmp(ev.journey_type_name);
    case "status": return cmp(ev.status_name);
    case "status_group":
      return cond.op === "is_not" ? ev.status_group !== cond.value : ev.status_group === cond.value;
    case "venue": return cmp(ev.venue_name);
    case "dj_assigned": return boolOp(ev.dj_assigned, cond.op);
    case "salesperson_assigned": return boolOp(!!ev.salesperson_id, cond.op);
    case "poc_assigned": return boolOp(!!ev.poc_employee_id, cond.op);
    case "planning_seeded": return boolOp(ev.planning_seeded, cond.op);
    case "has_vibo_link": return boolOp(!!ev.custom_fields?.["vibo_link"], cond.op);
    case "call_booked": return boolOp(truthy(ev.custom_fields?.["call_booked"]), cond.op);
    default: return true; // unknown field → ignore, never block a task
  }
}

function matchesConditions(rule: RuleRow, ev: EvalEvent): boolean {
  const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
  if (conds.length === 0) return true;
  const results = conds.map((c) => evalCondition(c, ev));
  return rule.condition_logic === "any" ? results.some(Boolean) : results.every(Boolean);
}

function anchorDay(anchor: string, ev: EvalEvent): number | null {
  switch (anchor) {
    case "event_date": return ev.event_day;
    case "booked_date": return ev.booked_day;
    case "contract_due_date": return ev.contract_due_day;
    case "created_at": return ev.created_day;
    default: return null;
  }
}

// ---- Title / body token rendering -----------------------------------------

function eventLabel(ev: EvalEvent): string {
  const who = ev.client_names || "Client";
  const type = ev.event_type_name || "Event";
  const date = ev.event_day != null ? ` (${epochDayToUS(ev.event_day)})` : "";
  return `${who}'s ${type}${date}`;
}

function renderTokens(tpl: string, ev: EvalEvent): string {
  const map: Record<string, string> = {
    "{{event_label}}": eventLabel(ev),
    "{{client_name}}": ev.client_names || "the client",
    "{{event_type}}": ev.event_type_name || "event",
    "{{event_date}}": ev.event_day != null ? epochDayToUS(ev.event_day) : "",
    "{{event_number}}": ev.event_number != null ? String(ev.event_number) : "",
    "{{dj_name}}": ev.dj_name || "the DJ",
  };
  let out = tpl;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

// ---- The evaluator --------------------------------------------------------

export type EvaluateResult = {
  ok: boolean;
  created: number;
  rules_evaluated: number;
  events_scanned: number;
  error?: string;
};

/**
 * Evaluate every active rule against upcoming events and insert any new tasks.
 * `admin` must be a service-role client (bypasses RLS). Safe to run repeatedly —
 * dedupe_key prevents duplicates. Never throws; returns a summary.
 */
export async function evaluateTaskRules(admin: SupabaseClient): Promise<EvaluateResult> {
  try {
    const today = todayEpochDay();
    const GRACE = 1; // also fire yesterday's date-anchored rules, in case a day was missed

    const { data: rules } = await admin
      .from("task_rules")
      .select(
        "id,is_active,trigger_anchor,offset_days,horizon_days,conditions,condition_logic,task_title,task_body,task_priority,assignee_type,assignee_employee_id,assignee_department,due_offset_days,due_anchor",
      )
      .eq("is_active", true);
    const activeRules = (rules ?? []) as RuleRow[];
    if (activeRules.length === 0) return { ok: true, created: 0, rules_evaluated: 0, events_scanned: 0 };

    // Candidate events: not archived, dated from yesterday onward (upcoming work).
    const fromIso = epochDayToIso(today - GRACE);
    const { data: rawEvents } = await admin
      .from("events")
      .select(
        `id,event_number,event_date,booked_date,contract_due_date,created_at,client_id,custom_fields,planning_seeded,salesperson_id,point_of_contact_employee_id,
         event_type:event_types(name),
         journey_type:journey_types(name),
         status:event_statuses(name,is_booked_group,is_pending_group,is_leads_group,is_lost_sale_group),
         venue:venues(name)`,
      )
      .is("archived_at", null)
      .gte("event_date", fromIso);
    const events = rawEvents ?? [];
    if (events.length === 0) return { ok: true, created: 0, rules_evaluated: activeRules.length, events_scanned: 0 };

    const eventIds = events.map((e) => e.id as string);

    // event_staff → DJ assignment; event_clients → display names.
    const [{ data: staffRows }, { data: clientRows }, { data: employees }, { data: existingTasks }] =
      await Promise.all([
        admin
          .from("event_staff")
          .select("event_id,role,employee:employees(id,first_name,last_name,stage_name)")
          .in("event_id", eventIds),
        admin
          .from("event_clients")
          .select("event_id,is_primary,client:clients(first_name,last_name)")
          .in("event_id", eventIds),
        admin.from("employees").select("id,staff_category"),
        admin.from("tasks").select("dedupe_key").not("dedupe_key", "is", null),
      ]);

    const empDept = new Map<string, string | null>(
      (employees ?? []).map((e) => [e.id as string, (e.staff_category as string) ?? null]),
    );
    const seen = new Set<string>((existingTasks ?? []).map((t) => t.dedupe_key as string));

    // Index DJ + client names per event.
    const djByEvent = new Map<string, { id: string; name: string }>();
    for (const s of staffRows ?? []) {
      const role = (s.role as string) ?? "";
      if (!/dj/i.test(role)) continue;
      const eid = s.event_id as string;
      if (djByEvent.has(eid)) continue; // first DJ wins
      const emp = s.employee as unknown as { id: string; first_name?: string; last_name?: string; stage_name?: string } | null;
      if (!emp) continue;
      djByEvent.set(eid, { id: emp.id, name: emp.stage_name || [emp.first_name, emp.last_name].filter(Boolean).join(" ") });
    }
    const clientsByEvent = new Map<string, string[]>();
    for (const c of clientRows ?? []) {
      const eid = c.event_id as string;
      const cl = c.client as unknown as { first_name?: string; last_name?: string } | null;
      if (!cl?.first_name) continue;
      const arr = clientsByEvent.get(eid) ?? [];
      // primary first
      if (c.is_primary) arr.unshift(cl.first_name);
      else arr.push(cl.first_name);
      clientsByEvent.set(eid, arr);
    }

    function statusGroup(s: {
      is_booked_group?: boolean;
      is_pending_group?: boolean;
      is_leads_group?: boolean;
      is_lost_sale_group?: boolean;
    } | null): EvalEvent["status_group"] {
      if (!s) return null;
      if (s.is_booked_group) return "booked";
      if (s.is_lost_sale_group) return "lost";
      if (s.is_pending_group) return "pending";
      if (s.is_leads_group) return "leads";
      return null;
    }

    const toDay = (v: unknown): number | null => (typeof v === "string" && v ? isoToEpochDay(v) : null);

    const ctx: EvalEvent[] = events.map((e) => {
      const dj = djByEvent.get(e.id as string);
      const status = e.status as unknown as {
        name?: string;
        is_booked_group?: boolean;
        is_pending_group?: boolean;
        is_leads_group?: boolean;
        is_lost_sale_group?: boolean;
      } | null;
      return {
        id: e.id as string,
        event_number: (e.event_number as number) ?? null,
        event_day: toDay(e.event_date),
        booked_day: toDay(e.booked_date),
        contract_due_day: toDay(e.contract_due_date),
        created_day: e.created_at ? tsToEpochDay(e.created_at as string) : null,
        client_id: (e.client_id as string) ?? null,
        custom_fields: (e.custom_fields as Record<string, unknown>) ?? {},
        planning_seeded: !!e.planning_seeded,
        salesperson_id: (e.salesperson_id as string) ?? null,
        poc_employee_id: (e.point_of_contact_employee_id as string) ?? null,
        event_type_name: (e.event_type as unknown as { name?: string } | null)?.name ?? null,
        journey_type_name: (e.journey_type as unknown as { name?: string } | null)?.name ?? null,
        status_name: status?.name ?? null,
        status_group: statusGroup(status),
        venue_name: (e.venue as unknown as { name?: string } | null)?.name ?? null,
        dj_assigned: !!dj,
        dj_employee_id: dj?.id ?? null,
        dj_name: dj?.name ?? null,
        client_names: (clientsByEvent.get(e.id as string) ?? []).join(" & "),
      };
    });

    const inserts: Array<Record<string, unknown>> = [];
    for (const rule of activeRules) {
      for (const ev of ctx) {
        // ---- WHEN ----
        let fires = false;
        let dueBaseDay: number | null = null;
        if (rule.trigger_anchor === "none") {
          if (ev.event_day == null) continue;
          const horizon = rule.horizon_days ?? 90;
          if (ev.event_day < today || ev.event_day > today + horizon) continue;
          fires = true;
          dueBaseDay = ev.event_day;
        } else {
          const base = anchorDay(rule.trigger_anchor, ev);
          if (base == null) continue;
          const trigger = base + rule.offset_days;
          if (trigger > today || trigger < today - GRACE) continue;
          fires = true;
          dueBaseDay = base;
        }
        if (!fires) continue;

        // ---- CONDITIONS ----
        if (!matchesConditions(rule, ev)) continue;

        // ---- DEDUPE ----
        const dedupe = `rule:${rule.id}:event:${ev.id}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);

        // ---- ASSIGNEE ----
        let assignee: string | null = null;
        let department: string | null = null;
        switch (rule.assignee_type) {
          case "staff": assignee = rule.assignee_employee_id; break;
          case "department": department = rule.assignee_department; break;
          case "event_poc": assignee = ev.poc_employee_id; break;
          case "event_salesperson": assignee = ev.salesperson_id; break;
          case "event_dj": assignee = ev.dj_employee_id; break;
        }
        if (assignee && !department) department = empDept.get(assignee) ?? null;

        // ---- DUE DATE ----
        const dueAnchor = rule.due_anchor;
        let dueDay: number | null = dueBaseDay;
        if (dueAnchor && dueAnchor !== "none") dueDay = anchorDay(dueAnchor, ev) ?? dueBaseDay;
        const due_date = dueDay != null ? epochDayToIso(dueDay + (rule.due_offset_days ?? 0)) : null;

        inserts.push({
          title: renderTokens(rule.task_title, ev),
          body: rule.task_body ? renderTokens(rule.task_body, ev) : null,
          status: "not_started",
          priority: rule.task_priority ?? "normal",
          assigned_employee_id: assignee,
          department,
          event_id: ev.id,
          client_id: ev.client_id,
          rule_id: rule.id,
          due_date,
          dedupe_key: dedupe,
        });
      }
    }

    let created = 0;
    if (inserts.length > 0) {
      // chunked insert; dedupe_key unique index is the final backstop
      for (let i = 0; i < inserts.length; i += 500) {
        const chunk = inserts.slice(i, i + 500);
        const { error } = await admin.from("tasks").insert(chunk);
        if (!error) created += chunk.length;
      }
    }

    await admin
      .from("task_rules")
      .update({ last_evaluated_at: new Date().toISOString() })
      .in("id", activeRules.map((r) => r.id));

    return { ok: true, created, rules_evaluated: activeRules.length, events_scanned: ctx.length };
  } catch (e) {
    return {
      ok: false,
      created: 0,
      rules_evaluated: 0,
      events_scanned: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
