import type { SupabaseClient } from "@supabase/supabase-js";
import { createEventOnboardingRecord, type OnboardingClient } from "@/lib/eventOnboarding";
import { onboardingEffects, saveArticle, saveBackdrop, saveBriefingPref, saveDocumentBlocks, saveHelperButton, saveWeekdayPrices } from "@/lib/officeEdits";
import { assertVenueTravelFeeScope } from "@/lib/officeRemaining";
import { sanitizeLayout, type Role } from "@/lib/dashboardWidgets";
import { syncRecent, firefliesConfigured } from "@/lib/fireflies";
import {
  SCHEDULE_TEMPLATE_COLUMNS,
  mapTemplate,
  targetDateFor,
  zonedParts,
  type AnchorDates,
  type TemplateRow,
} from "@/lib/scheduledComms";
import { assertEffectScopes, collectAutomationEffects, collectHelperEffects } from "../effects";
import { setEventContractHolder } from "../eventMembership";
import {
  INQUIRY_SOURCE_NAME_SCHEMA,
  NEW_SOURCE_NAME_SCHEMA,
  createOrReuseInquirySource,
  findInquirySourceByNameInsensitive,
  planEventInquirySource,
  resolveEventInquirySource,
} from "../inquirySource";
import {
  addContact,
  addEventQuestion,
  addEventSection,
  addTemplateQuestion,
  addTemplateSection,
  deleteTemplateQuestion,
  removeContact,
  saveHelperVisibility,
  saveTemplateSchedule,
  spotifyExistingConnection,
  updateEventQuestion,
  updateEventSection,
  updateTemplateQuestion,
  type EditorDb,
} from "@/lib/officeEdits";
import type { LiveTool } from "../protocol";
import { McpScopeError, type ToolContext } from "../types";
import type { JsonSchema } from "../validate";

const UUID: JsonSchema = { type: "string", format: "uuid" };
const STR: JsonSchema = { type: "string" };

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", additionalProperties: false, properties, required };
}

function adminOf(ctx: ToolContext): SupabaseClient {
  if (!ctx.admin || typeof ctx.admin.from !== "function") throw new Error("Database client is not available.");
  return ctx.admin;
}

async function query(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

function s(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function n(args: Record<string, unknown>, key: string): number | null {
  return typeof args[key] === "number" && Number.isFinite(args[key]) ? (args[key] as number) : null;
}

function bool(args: Record<string, unknown>, key: string): boolean | null {
  return typeof args[key] === "boolean" ? args[key] : null;
}

function json<T>(args: Record<string, unknown>, key: string, fallback: T): T {
  const raw = s(args, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${key} must be JSON.`);
  }
}

async function snapshotVersion(admin: SupabaseClient, table: "packages" | "addons", id: string, mode: string | null) {
  const versionTable = table === "packages" ? "package_versions" : "addon_versions";
  const fk = table === "packages" ? "package_id" : "addon_id";
  const { data: row, error } = await admin.from(table).select("*").eq("id", id).single();
  if (error || !row) return;
  if (mode === "new") {
    const newVersion = ((row.current_version as number | null) ?? 1) + 1;
    const { error: bumpError } = await admin.from(table).update({ current_version: newVersion }).eq("id", id);
    if (bumpError) throw new Error(bumpError.message);
    const { error: insError } = await admin.from(versionTable).insert({ [fk]: id, version_no: newVersion, snapshot: { ...row, current_version: newVersion } });
    if (insError) throw new Error(insError.message);
  } else {
    const { error: upError } = await admin.from(versionTable).upsert(
      { [fk]: id, version_no: (row.current_version as number | null) ?? 1, snapshot: row },
      { onConflict: `${fk},version_no` },
    );
    if (upError) throw new Error(upError.message);
  }
}

const MERGE_FIELDS = new Set([
  "name", "address", "city", "state", "zip", "category_id", "travel_fee", "setup_fee",
  "distance_miles", "driving_notes", "load_in_details", "notes", "is_one_time", "auto_mileage",
  "contact_name", "phone", "email", "website",
]);

export const coverageTools: LiveTool[] = [
  {
    name: "events_create_onboarding",
    description: "Create an event the way the new-event wizard does: clients, venue, package, add-ons, schedule, and staff, then run event-created automations for that event only. List sources first with events_form_options, pick a match (inquiry_source_id or exact case-sensitive inquiry_source_name), and create a new one with new_source_name only if nothing matches.",
    scopes: ["write.events", "write.clients"],
    confirm: true,
    inputSchema: obj({
      clients_json: { type: "string", minLength: 2 },
      name: STR,
      event_type_id: UUID,
      status_id: UUID,
      event_date: STR,
      package_id: UUID,
      venue_id: UUID,
      schedule_plan: STR,
      staff_json: STR,
      addons_json: STR,
      discounts_json: STR,
      custom_dates_json: STR,
      new_venue_json: STR,
      inquiry_source_id: UUID,
      inquiry_source_name: INQUIRY_SOURCE_NAME_SCHEMA,
      new_source_name: NEW_SOURCE_NAME_SCHEMA,
      new_source_persist: { type: "boolean", description: "When inserting a new source, store it as active (true) or one-time inactive (false)." },
      use_client_address: { type: "boolean" },
      client_address: STR,
      venue_room_id: UUID,
      setup_time: STR,
      start_time: STR,
      end_time: STR,
      guest_count: { type: "number" },
      package_price_override: { type: "number" },
      deposit_value: { type: "number" },
      travel_fee: { type: "number" },
      internal_notes: STR,
      contract_notes: STR,
    }, ["clients_json"]),
    async authorize(args, ctx) {
      const admin = adminOf(ctx);
      const newName = s(args, "new_source_name");
      const willCreateSource = Boolean(newName) && !(await findInquirySourceByNameInsensitive(admin, newName!));
      const normalized = onboardingEffects({
        staff: json(args, "staff_json", []),
        newVenue: json(args, "new_venue_json", null),
        newSourceName: willCreateSource ? newName : null,
        packagePriceOverride: args.package_price_override,
        depositValue: args.deposit_value,
        travelFee: args.travel_fee,
        discounts: json(args, "discounts_json", []),
        addons: json(args, "addons_json", []),
      });
      const missing = normalized.scopes.filter((scope) => !ctx.token.scopes.includes(scope));
      if (missing.length) throw new McpScopeError(`This wizard needs ${missing.join(", ")}.`);
      const { data, error } = await admin.from("booking_helpers").select("id, event_type_ids").eq("is_active", true).eq("auto_on_create", true);
      if (error) throw new Error(error.message);
      const eventType = s(args, "event_type_id");
      for (const helper of data ?? []) {
        const types = (helper.event_type_ids as string[] | null) ?? [];
        if (types.length && eventType && !types.includes(eventType)) continue;
        assertEffectScopes(ctx.token.scopes, await collectHelperEffects(admin, helper.id as string));
      }
      const { data: notices, error: noticeError } = await admin.from("notification_settings").select("email, sms").eq("type_key", "event_created").eq("is_enabled", true);
      if (noticeError) throw new Error(noticeError.message);
      if ((notices ?? []).some((row) => row.email) && !ctx.token.scopes.includes("comms.email")) {
        throw new McpScopeError("Creating this event emails staff and needs comms.email.");
      }
      if ((notices ?? []).some((row) => row.sms) && !ctx.token.scopes.includes("comms.sms")) {
        throw new McpScopeError("Creating this event texts staff and needs comms.sms.");
      }
    },
    async freeze(args, ctx) {
      const admin = adminOf(ctx);
      const source = await planEventInquirySource(admin, args);
      const newName = s(args, "new_source_name");
      const willCreateSource = source.provided && source.created;
      const normalized = onboardingEffects({
        staff: json(args, "staff_json", []),
        newVenue: json(args, "new_venue_json", null),
        newSourceName: willCreateSource ? newName : null,
        packagePriceOverride: args.package_price_override,
        depositValue: args.deposit_value,
        travelFee: args.travel_fee,
        discounts: json(args, "discounts_json", []),
        addons: json(args, "addons_json", []),
      });
      const effects = [];
      const { data } = await admin.from("booking_helpers").select("id, event_type_ids").eq("is_active", true).eq("auto_on_create", true);
      const eventType = s(args, "event_type_id");
      for (const helper of data ?? []) {
        const types = (helper.event_type_ids as string[] | null) ?? [];
        if (types.length && eventType && !types.includes(eventType)) continue;
        effects.push(await collectHelperEffects(admin, helper.id as string));
      }
      return {
        normalized,
        clients: json<OnboardingClient[]>(args, "clients_json", []),
        automations: effects,
        inquiry_source_id: source.provided && !source.created ? source.id : null,
        inquiry_source_will_create: willCreateSource,
        inquiry_source_new_name: willCreateSource ? newName : null,
      };
    },
    async preview(args, ctx) {
      const frozen = await (coverageTools.find((tool) => tool.name === "events_create_onboarding")!.freeze!(args, ctx));
      return frozen;
    },
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      // Resolve/create in MCP first, then pass only the id into createEventCore so the UI
      // auto-create path is not used from the connector.
      const source = await resolveEventInquirySource(admin, args);
      const created = await createEventOnboardingRecord(admin, {
        clients: json<OnboardingClient[]>(args, "clients_json", []),
        discounts: json(args, "discounts_json", []),
        addons: json(args, "addons_json", []),
        staff: onboardingEffects({ staff: json(args, "staff_json", []) }).staff,
        customDates: json(args, "custom_dates_json", []),
        newVenue: json(args, "new_venue_json", null),
        inquirySourceId: source.provided ? source.id : null,
        newSourceName: null,
        newSourcePersist: false,
        useClientAddress: args.use_client_address === true,
        clientAddress: s(args, "client_address"),
        venueId: s(args, "venue_id"),
        venueRoomId: s(args, "venue_room_id"),
        eventTypeId: s(args, "event_type_id"),
        name: s(args, "name"),
        statusId: s(args, "status_id"),
        eventDate: s(args, "event_date"),
        setupTime: s(args, "setup_time"),
        startTime: s(args, "start_time"),
        endTime: s(args, "end_time"),
        guestCount: n(args, "guest_count"),
        packageId: s(args, "package_id"),
        packagePriceOverride: n(args, "package_price_override"),
        depositValue: n(args, "deposit_value"),
        travelFee: n(args, "travel_fee") ?? 0,
        internalNotes: s(args, "internal_notes"),
        contractNotes: s(args, "contract_notes"),
        schedulePlan: s(args, "schedule_plan"),
        drain: "hold",
      });
      return {
        id: created.id,
        inquiry_source_id: source.provided ? source.id : null,
        inquiry_source_created: source.provided ? source.created : false,
        delivery: "pending_second_approval",
        detail: "The event exists. Helper mail is held. Notifications and webhooks wait for events_release_held_sends. The outbox cron does not claim held rows.",
        effects: await collectAutomationEffects(admin, created.id, "event_created"),
      };
    },
  },
  {
    name: "events_add_expense",
    description: "Add an expense on an event. Pass category_id or a new category name.",
    scopes: ["money"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, amount: { type: "number", minimum: 0 }, payee: STR, description: STR, category_id: UUID, new_category: STR, expense_date: STR, payment_method: STR }, ["event_id", "amount"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      let categoryId = s(args, "category_id");
      if (s(args, "new_category")) {
        const created = await query(admin.from("expense_categories").upsert({ name: s(args, "new_category") }, { onConflict: "name" }).select("id").single()) as { id: string };
        categoryId = created.id;
      }
      const row = await query(admin.from("expenses").insert({
        event_id: s(args, "event_id"),
        category_id: categoryId,
        payee: s(args, "payee"),
        payment_method: s(args, "payment_method"),
        description: s(args, "description"),
        amount: n(args, "amount"),
        expense_date: s(args, "expense_date") ?? undefined,
      }).select("id").single()) as { id: string };
      return { id: row.id };
    },
  },
  {
    name: "events_delete_expense",
    description: "Delete one expense that belongs to the given event.",
    scopes: ["money", "delete"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, expense_id: UUID }, ["event_id", "expense_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("expenses").delete().eq("id", s(args, "expense_id")).eq("event_id", s(args, "event_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_add_trip",
    description: "Add a mileage trip on an event. The vehicle name is created if it is new.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, miles: { type: "number", minimum: 0 }, vehicle: STR, trip_date: STR, notes: STR }, ["event_id", "miles"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      let vehicleId: string | null = null;
      if (s(args, "vehicle")) {
        const vehicle = await query(admin.from("vehicles").upsert({ name: s(args, "vehicle") }, { onConflict: "name" }).select("id").single()) as { id: string };
        vehicleId = vehicle.id;
      }
      const row = await query(admin.from("event_trips").insert({
        event_id: s(args, "event_id"), vehicle_id: vehicleId, trip_date: s(args, "trip_date") ?? undefined, miles: n(args, "miles"), notes: s(args, "notes"),
      }).select("id").single()) as { id: string };
      return { id: row.id };
    },
  },
  {
    name: "events_delete_trip",
    description: "Delete one trip that belongs to the given event.",
    scopes: ["delete"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, trip_id: UUID }, ["event_id", "trip_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("event_trips").delete().eq("id", s(args, "trip_id")).eq("event_id", s(args, "event_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_add_equipment",
    description: "Put an equipment item or system on an event. Pass item_id or system_id.",
    scopes: ["write.events", "write.equipment"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, item_id: UUID, system_id: UUID, quantity: { type: "integer", minimum: 1 } }, ["event_id"]),
    async execute(args, ctx) {
      const row = await query(adminOf(ctx).from("event_equipment").insert({
        event_id: s(args, "event_id"),
        item_id: s(args, "item_id"),
        system_id: s(args, "system_id"),
        quantity: Math.max(1, Math.round(n(args, "quantity") || 1)),
      }).select("id").single()) as { id: string };
      return { id: row.id };
    },
  },
  {
    name: "events_remove_equipment",
    description: "Remove one equipment row from an event.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, row_id: UUID }, ["event_id", "row_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("event_equipment").delete().eq("id", s(args, "row_id")).eq("event_id", s(args, "event_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_add_vendor",
    description: "Attach a vendor to an event.",
    scopes: ["write.events", "write.vendors"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, vendor_id: UUID, role: STR }, ["event_id", "vendor_id"]),
    async execute(args, ctx) {
      const row = await query(adminOf(ctx).from("event_vendors").insert({
        event_id: s(args, "event_id"), vendor_id: s(args, "vendor_id"), role: s(args, "role"),
      }).select("id").single()) as { id: string };
      return { id: row.id };
    },
  },
  {
    name: "events_remove_vendor",
    description: "Remove a vendor assignment from an event.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, event_vendor_id: UUID }, ["event_id", "event_vendor_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("event_vendors").delete().eq("id", s(args, "event_vendor_id")).eq("event_id", s(args, "event_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_set_primary_client",
    description: "Make one membership the primary client on an event.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, event_client_id: UUID }, ["event_id", "event_client_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).rpc("mcp_set_primary_client", {
        p_event_id: s(args, "event_id"),
        p_event_client_id: s(args, "event_client_id"),
      });
      if (error) {
        if (/mcp_set_primary_client|schema cache|could not find/i.test(error.message)) {
          throw new Error("Choosing the primary client needs migration 00221. Nothing was changed.");
        }
        throw new Error(error.message);
      }
      return { ok: true };
    },
  },
  {
    name: "events_set_contract_holder",
    description: "Set or clear the Booking Agreement holder flag on one event membership, the same way Mark holder / Unset holder does on the event page (mcp_toggle_contract_holder).",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, event_client_id: UUID, contract_holder: { type: "boolean" } }, ["event_id", "event_client_id", "contract_holder"]),
    async execute(args, ctx) {
      return setEventContractHolder(adminOf(ctx), {
        eventId: s(args, "event_id")!,
        eventClientId: s(args, "event_client_id")!,
        contractHolder: args.contract_holder === true,
      });
    },
  },
  {
    name: "scheduled_comms_skip",
    description: "Skip one scheduled email or text for one event and date. This does not send anything.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, template_id: UUID, target_date: STR, action: { type: "string", enum: ["skip", "undo", "mark_sent"] } }, ["event_id", "template_id", "target_date", "action"]),
    async execute(args, ctx) {
      return scheduledComm(adminOf(ctx), s(args, "event_id")!, s(args, "template_id")!, s(args, "target_date")!, s(args, "action") as "skip" | "undo" | "mark_sent", ctx.token.name);
    },
  },
  {
    name: "scheduled_comms_override",
    description: "Replace the subject and body of one scheduled send for one event. The shared template is not changed. An email template needs comms.email. A text template needs comms.sms.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, template_id: UUID, target_date: STR, subject: STR, body_html: { type: "string", minLength: 1 }     }, ["event_id", "template_id", "target_date", "body_html"]),
    async authorize(args, ctx) {
      const { data, error } = await adminOf(ctx).from("email_templates").select("is_sms").eq("id", s(args, "template_id")).maybeSingle();
      if (error) throw new Error(error.message);
      const need = data?.is_sms ? "comms.sms" : "comms.email";
      if (!ctx.token.scopes.includes(need)) throw new McpScopeError(`This scheduled ${data?.is_sms ? "text" : "email"} needs ${need}.`);
    },
    async preview(args) {
      return { target_date: s(args, "target_date"), subject: s(args, "subject"), body: s(args, "body_html") };
    },
    async freeze(args) {
      return { target_date: s(args, "target_date"), subject: s(args, "subject"), body: s(args, "body_html") };
    },
    async execute(args, ctx) {
      return saveScheduledOverride(adminOf(ctx), s(args, "event_id")!, s(args, "template_id")!, s(args, "target_date")!, s(args, "subject"), s(args, "body_html")!, ctx.token.name);
    },
  },
  {
    name: "fireflies_review",
    description: "Approve or dismiss a Fireflies suggestion, or attach or unlink a meeting on an event. Sync pulls recent meetings and does not send mail.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({
      action: { type: "string", enum: ["approve", "dismiss", "attach", "unlink", "sync"] },
      event_id: UUID,
      suggestion_id: UUID,
      meeting_id: UUID,
    }, ["action"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const action = s(args, "action");
      if (action === "sync") {
        if (!firefliesConfigured()) return { imported: 0, error: "Fireflies is not configured on the server." };
        return syncRecent(admin, { limit: 25 });
      }
      if (action === "approve" || action === "dismiss") {
        const { error } = await admin.from("fireflies_suggested_tasks").update({ status: action === "approve" ? "approved" : "dismissed", decided_at: new Date().toISOString() }).eq("id", s(args, "suggestion_id"));
        if (error) throw new Error(error.message);
        return { ok: true };
      }
      const meetingId = s(args, "meeting_id");
      const eventId = action === "unlink" ? null : s(args, "event_id");
      const { error } = await admin.from("fireflies_meetings").update({ event_id: eventId, matched_by: "manual", updated_at: new Date().toISOString() }).eq("id", meetingId);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "packages_update",
    description: "Update a package name, price, deposit, and hours, then snapshot the current version or start a new version.",
    scopes: ["write.catalog"],
    confirm: true,
    inputSchema: obj({
      package_id: UUID,
      name: STR,
      description: STR,
      default_price: { type: "number", minimum: 0 },
      deposit_value: { type: "number", minimum: 0 },
      included_hours: { type: "number", minimum: 0 },
      is_active: { type: "boolean" },
      version_mode: { type: "string", enum: ["current", "new"] },
    }, ["package_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "description", "default_price", "deposit_value", "included_hours", "is_active"]) {
        if (key in args) patch[key] = args[key];
      }
      const { error } = await admin.from("packages").update(patch).eq("id", s(args, "package_id"));
      if (error) throw new Error(error.message);
      await snapshotVersion(admin, "packages", s(args, "package_id")!, s(args, "version_mode") ?? "current");
      return { ok: true };
    },
  },
  {
    name: "packages_add_date_price",
    description: "Add a date-range price on a package.",
    scopes: ["write.catalog"],
    confirm: true,
    inputSchema: obj({ package_id: UUID, start_date: STR, end_date: STR, price: { type: "number", minimum: 0 }, label: STR }, ["package_id", "start_date", "price"]),
    async execute(args, ctx) {
      const row = await query(adminOf(ctx).from("package_date_prices").insert({
        package_id: s(args, "package_id"),
        label: s(args, "label"),
        start_date: s(args, "start_date"),
        end_date: s(args, "end_date") ?? s(args, "start_date"),
        price: n(args, "price"),
      }).select("id").single()) as { id: string };
      return { id: row.id };
    },
  },
  {
    name: "packages_delete_date_price",
    description: "Delete one package date price.",
    scopes: ["write.catalog", "delete"],
    confirm: true,
    inputSchema: obj({ package_id: UUID, price_id: UUID }, ["package_id", "price_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("package_date_prices").delete().eq("id", s(args, "price_id")).eq("package_id", s(args, "package_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "addons_update",
    description: "Update an add-on name and price, then snapshot the current version or start a new version.",
    scopes: ["write.catalog"],
    confirm: true,
    inputSchema: obj({ addon_id: UUID, name: STR, default_price: { type: "number", minimum: 0 }, is_active: { type: "boolean" }, version_mode: { type: "string", enum: ["current", "new"] } }, ["addon_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "default_price", "is_active"]) if (key in args) patch[key] = args[key];
      const { error } = await admin.from("addons").update(patch).eq("id", s(args, "addon_id"));
      if (error) throw new Error(error.message);
      await snapshotVersion(admin, "addons", s(args, "addon_id")!, s(args, "version_mode") ?? "current");
      return { ok: true };
    },
  },
  {
    name: "venues_update",
    description: "Update a venue name, address, fees, and mileage flag. Changing travel_fee needs the money scope and human approval.",
    scopes: ["write.venues"],
    confirm: true,
    inputSchema: obj({ venue_id: UUID, name: STR, address: STR, city: STR, state: STR, travel_fee: { type: "number" }, distance_miles: { type: "number" }, auto_mileage: { type: "boolean" }, notes: STR }, ["venue_id"]),
    async authorize(args, ctx) {
      try {
        assertVenueTravelFeeScope(args, ctx.token.scopes);
      } catch (err) {
        throw new McpScopeError(err instanceof Error ? err.message : "Changing a venue travel fee needs money.");
      }
    },
    async execute(args, ctx) {
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "address", "city", "state", "travel_fee", "distance_miles", "auto_mileage", "notes"]) if (key in args) patch[key] = args[key];
      const { error } = await adminOf(ctx).from("venues").update(patch).eq("id", s(args, "venue_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "venues_merge",
    description: "Merge loser venues into a survivor: move events, contacts, and rooms, then delete the losers.",
    scopes: ["write.venues", "delete"],
    confirm: true,
    inputSchema: obj({ survivor_id: UUID, loser_ids_json: STR, fields_json: STR }, ["survivor_id", "loser_ids_json"]),
    async execute(args, ctx) {
      const losers = json<string[]>(args, "loser_ids_json", []).filter((id) => id && id !== s(args, "survivor_id"));
      if (!losers.length) throw new Error("Name at least one venue to merge away.");
      const fields = json<Record<string, unknown>>(args, "fields_json", {});
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) if (MERGE_FIELDS.has(key)) patch[key] = value;
      const { error } = await adminOf(ctx).rpc("mcp_merge_venues", {
        p_survivor: s(args, "survivor_id"),
        p_losers: losers,
        p_fields: patch,
      });
      if (error) {
        if (/mcp_merge_venues|schema cache|could not find/i.test(error.message)) {
          throw new Error("Merging venues needs migration 00221. Nothing was changed.");
        }
        throw new Error(error.message);
      }
      return { merged: losers.length };
    },
  },
  {
    name: "vendors_update",
    description: "Update a vendor company name, category, email, and phone.",
    scopes: ["write.vendors"],
    confirm: false,
    inputSchema: obj({ vendor_id: UUID, company_name: STR, category: STR, email: STR, phone: STR, notes: STR }, ["vendor_id"]),
    async execute(args, ctx) {
      const patch: Record<string, unknown> = {};
      for (const key of ["company_name", "category", "email", "phone", "notes"]) if (key in args) patch[key] = args[key];
      const { error } = await adminOf(ctx).from("vendors").update(patch).eq("id", s(args, "vendor_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "vendor_suggestions_review",
    description: "List, apply, or dismiss a vendor-match suggestion. Apply fills blank contact fields and can merge a duplicate vendor.",
    scopes: ["write.vendors"],
    confirm: true,
    inputSchema: obj({ action: { type: "string", enum: ["list", "apply", "dismiss"] }, suggestion_id: UUID }, ["action"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      if (s(args, "action") === "list") {
        return { suggestions: await query(admin.from("vendor_match_suggestions").select("id, kind, status, event_vendor_id, matched_vendor_id, proposed").eq("status", "pending").limit(50)) };
      }
      const id = s(args, "suggestion_id");
      if (s(args, "action") === "dismiss") {
        const { error } = await admin.from("vendor_match_suggestions").update({ status: "dismissed" }).eq("id", id);
        if (error) throw new Error(error.message);
        return { ok: true };
      }
      return applyVendorSuggestion(admin, id!);
    },
  },
  {
    name: "staff_update",
    description: "Update an employee name, email, phone, and active flag. Wage changes stay on staff_update_wages.",
    scopes: ["write.staff"],
    confirm: false,
    inputSchema: obj({ employee_id: UUID, first_name: STR, last_name: STR, email: STR, phone: STR, is_active: { type: "boolean" } }, ["employee_id"]),
    async execute(args, ctx) {
      const patch: Record<string, unknown> = {};
      for (const key of ["first_name", "last_name", "email", "phone", "is_active"]) if (key in args) patch[key] = args[key];
      const { error } = await adminOf(ctx).from("employees").update(patch).eq("id", s(args, "employee_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "timesheet_requests",
    description: "List, approve, or deny a timesheet change. Approve copies the requested times onto the staff assignment.",
    scopes: ["money.payroll"],
    confirm: true,
    inputSchema: obj({ action: { type: "string", enum: ["list", "approve", "deny"] }, request_id: UUID }, ["action"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      if (s(args, "action") === "list") {
        return { requests: await query(admin.from("timesheet_change_requests").select("id, event_staff_id, requested_check_in, requested_check_out, reason, status").eq("status", "pending").limit(50)) };
      }
      const id = s(args, "request_id");
      if (s(args, "action") === "approve") {
        const req = await query(admin.from("timesheet_change_requests").select("*").eq("id", id).maybeSingle()) as { event_staff_id: string; requested_check_in: string | null; requested_check_out: string | null } | null;
        if (!req) throw new Error("Request not found.");
        const patch: Record<string, string> = {};
        if (req.requested_check_in) patch.checked_in_at = req.requested_check_in;
        if (req.requested_check_out) patch.checked_out_at = req.requested_check_out;
        if (Object.keys(patch).length) {
          const { error } = await admin.from("event_staff").update(patch).eq("id", req.event_staff_id);
          if (error) throw new Error(error.message);
        }
      }
      const { error } = await admin.from("timesheet_change_requests").update({ status: s(args, "action") === "approve" ? "approved" : "denied", reviewed_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "equipment_update",
    description: "Update an equipment item name, category, serial number, and active flag.",
    scopes: ["write.equipment"],
    confirm: false,
    inputSchema: obj({ item_id: UUID, name: STR, category: STR, serial_number: STR, notes: STR, is_active: { type: "boolean" } }, ["item_id"]),
    async execute(args, ctx) {
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "category", "serial_number", "notes", "is_active"]) if (key in args) patch[key] = args[key];
      const { error } = await adminOf(ctx).from("equipment_items").update(patch).eq("id", s(args, "item_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "equipment_report_damage",
    description: "Report damage on an equipment item. Optional photo_base64 is stored in the equipment bucket and linked to the report.",
    scopes: ["write.equipment"],
    confirm: true,
    inputSchema: obj({ item_id: UUID, description: { type: "string", minLength: 1 }, photo_base64: STR, photo_name: STR, content_type: STR }, ["item_id", "description"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const report = await query(admin.from("equipment_damage_reports").insert({
        item_id: s(args, "item_id"), description: s(args, "description"), reported_by: ctx.token.name,
      }).select("id").single()) as { id: string };
      const photo = s(args, "photo_base64");
      if (photo) {
        if (photo.length > 1_500_000) throw new Error("That photo is too large.");
        const bytes = Buffer.from(photo, "base64");
        const path = `damage/${report.id}/${crypto.randomUUID()}-${(s(args, "photo_name") ?? "photo").replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
        const { error: uploadError } = await admin.storage.from("equipment").upload(path, bytes, { contentType: s(args, "content_type") ?? "image/jpeg" });
        if (uploadError) throw new Error(uploadError.message);
        await admin.from("equipment_photos").insert({ damage_report_id: report.id, storage_path: path });
      }
      return { id: report.id };
    },
  },
  {
    name: "equipment_resolve_damage",
    description: "Mark a damage report resolved.",
    scopes: ["write.equipment"],
    confirm: false,
    inputSchema: obj({ report_id: UUID }, ["report_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("equipment_damage_reports").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", s(args, "report_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "email_templates_update",
    description: "Update an email or SMS template subject, body, marketing flag, and attachment. Approval is required because later sends use this copy.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({
      template_id: UUID,
      name: STR,
      subject: STR,
      body_html: STR,
      is_active: { type: "boolean" },
      is_sms: { type: "boolean" },
      sms_marketing: { type: "boolean" },
      attach_template_id: UUID,
      attach_mode: { type: "string", enum: ["esign_link", "pdf"] },
      schedule_json: { type: "string", description: "Full schedule and visibility block. Omitting it leaves the schedule unchanged." },
    }, ["template_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "subject", "body_html", "is_active", "is_sms", "sms_marketing", "attach_template_id", "attach_mode"]) {
        if (key in args) patch[key] = args[key];
      }
      const { error } = await admin.from("email_templates").update(patch).eq("id", s(args, "template_id"));
      if (error) throw new Error(error.message);
      if (s(args, "schedule_json")) {
        await saveTemplateSchedule(admin as unknown as EditorDb, s(args, "template_id")!, json(args, "schedule_json", {}));
      }
      return { ok: true, schedule_replaced: Boolean(s(args, "schedule_json")) };
    },
  },
  {
    name: "helpers_update",
    description: "Update a booking helper title, active flag, webhook, actions JSON, and the full visibility block. Omitting visibility_json leaves visibility unchanged. Nested sends are authorized when the helper is run, not when it is saved.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ helper_id: UUID, title: STR, is_active: { type: "boolean" }, webhook_url: STR, actions_json: STR, visibility_json: STR }, ["helper_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const patch: Record<string, unknown> = {};
      if ("title" in args) patch.title = s(args, "title");
      if ("is_active" in args) patch.is_active = args.is_active === true;
      if ("webhook_url" in args) patch.webhook_url = s(args, "webhook_url");
      if (s(args, "actions_json")) {
        const actions = json<unknown[]>(args, "actions_json", []);
        if (!Array.isArray(actions)) throw new Error("actions_json must be an array.");
        patch.actions = actions;
      }
      if (Object.keys(patch).length) {
        const { error } = await admin.from("booking_helpers").update(patch).eq("id", s(args, "helper_id"));
        if (error) throw new Error(error.message);
      }
      if (s(args, "visibility_json")) {
        await saveHelperVisibility(admin as unknown as EditorDb, s(args, "helper_id")!, json(args, "visibility_json", {}));
      }
      return { ok: true, visibility_replaced: Boolean(s(args, "visibility_json")) };
    },
  },
  {
    name: "statuses_save",
    description: "Create or update an event status, including its color and which groups it counts toward.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ status_id: UUID, name: { type: "string", minLength: 1 }, color: STR, is_active: { type: "boolean" }, is_booked_group: { type: "boolean" }, counts_financial: { type: "boolean" } }, ["name"]),
    async execute(args, ctx) {
      const row = {
        name: s(args, "name"),
        color: s(args, "color") ?? "#F0F0F0",
        is_active: bool(args, "is_active") ?? true,
        is_booked_group: bool(args, "is_booked_group") ?? false,
        counts_financial: bool(args, "counts_financial") ?? false,
      };
      const admin = adminOf(ctx);
      if (s(args, "status_id")) {
        const { error } = await admin.from("event_statuses").update(row).eq("id", s(args, "status_id"));
        if (error) throw new Error(error.message);
        return { id: s(args, "status_id") };
      }
      const created = await query(admin.from("event_statuses").insert(row).select("id").single()) as { id: string };
      return { id: created.id };
    },
  },
  {
    name: "statuses_delete",
    description: "Delete an event status that no event or daily action uses.",
    scopes: ["delete"],
    confirm: true,
    inputSchema: obj({ status_id: UUID }, ["status_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "status_id");
      const [{ count: events }, { count: from }, { count: to }] = await Promise.all([
        admin.from("events").select("id", { count: "exact", head: true }).eq("status_id", id),
        admin.from("daily_status_actions").select("id", { count: "exact", head: true }).eq("from_status_id", id),
        admin.from("daily_status_actions").select("id", { count: "exact", head: true }).eq("to_status_id", id),
      ]);
      if ((events ?? 0) > 0 || (from ?? 0) > 0 || (to ?? 0) > 0) throw new Error("Status is in use. Deactivate it instead.");
      const { error } = await admin.from("event_statuses").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "sources_save",
    description: "Create or rename an inquiry source. List sources with events_form_options first, pick a match, and create a new one only if nothing matches. Creating without source_id reuses a trimmed case-insensitive name match instead of inserting a duplicate.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ source_id: UUID, name: { type: "string", minLength: 1 }, is_active: { type: "boolean" } }, ["name"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const name = s(args, "name")!;
      if (s(args, "source_id")) {
        const row = { name, is_active: bool(args, "is_active") ?? true };
        const { error } = await admin.from("inquiry_sources").update(row).eq("id", s(args, "source_id"));
        if (error) throw new Error(error.message);
        return { id: s(args, "source_id"), created: false };
      }
      const saved = await createOrReuseInquirySource(admin, {
        name,
        isActive: bool(args, "is_active") ?? true,
      });
      return { id: saved.id, created: saved.created, name: saved.name };
    },
  },
  {
    name: "custom_fields_save",
    description: "Create or rename a client role, event type, or file label.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ kind: { type: "string", enum: ["client_role", "event_type", "file_label"] }, id: UUID, name: { type: "string", minLength: 1 } }, ["kind", "name"]),
    async execute(args, ctx) {
      const table = s(args, "kind") === "client_role" ? "client_role_definitions" : s(args, "kind") === "event_type" ? "event_types" : "file_label_definitions";
      const admin = adminOf(ctx);
      if (s(args, "id")) {
        const { error } = await admin.from(table).update({ name: s(args, "name") }).eq("id", s(args, "id"));
        if (error) throw new Error(error.message);
        return { id: s(args, "id") };
      }
      const created = await query(admin.from(table).insert({ name: s(args, "name") }).select("id").single()) as { id: string };
      return { id: created.id };
    },
  },
  {
    name: "planner_templates_save",
    description: "Create or rename a planner template, or add a section with a title.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ template_id: UUID, name: STR, event_type_id: UUID, section_title: STR, section_type: { type: "string", enum: ["info", "timeline", "headline"] }, is_default: { type: "boolean" } }),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      let templateId = s(args, "template_id");
      if (!templateId) {
        const created = await query(admin.from("planning_templates").insert({ name: s(args, "name") ?? "New Template", event_type_id: s(args, "event_type_id") }).select("id").single()) as { id: string };
        templateId = created.id;
      } else if (s(args, "name") || "is_default" in args || "event_type_id" in args) {
        const patch: Record<string, unknown> = {};
        if (s(args, "name")) patch.name = s(args, "name");
        if ("event_type_id" in args) patch.event_type_id = s(args, "event_type_id");
        if ("is_default" in args) patch.is_default = args.is_default === true;
        if (args.is_default === true) await admin.from("planning_templates").update({ is_default: false }).neq("id", templateId);
        const { error } = await admin.from("planning_templates").update(patch).eq("id", templateId);
        if (error) throw new Error(error.message);
      }
      if (s(args, "section_title") || s(args, "section_type")) {
        await addTemplateSection(admin as unknown as EditorDb, templateId, { title: s(args, "section_title"), section_type: s(args, "section_type") });
      }
      return { id: templateId };
    },
  },
  {
    name: "planner_questions",
    description: "Add, update, or delete a question on a planner template section. The section must belong to that template. Short answers store no options. Photo options are kept when an update omits them.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({
      action: { type: "string", enum: ["add", "update", "delete"] },
      template_id: UUID,
      section_id: UUID,
      question_id: UUID,
      prompt: STR,
      answer_type: { type: "string" },
      options_json: STR,
      help_text: STR,
      required: { type: "boolean" },
    }, ["action", "template_id"]),
    async execute(args, ctx) {
      const db = adminOf(ctx) as unknown as EditorDb;
      const input = {
        prompt: s(args, "prompt"),
        answer_type: s(args, "answer_type") ?? undefined,
        options: s(args, "options_json") ? json(args, "options_json", []) : undefined,
        help_text: s(args, "help_text"),
        required: args.required === true,
      };
      if (s(args, "action") === "add") return addTemplateQuestion(db, s(args, "template_id")!, s(args, "section_id")!, input);
      if (s(args, "action") === "delete") return deleteTemplateQuestion(db, s(args, "template_id")!, s(args, "question_id")!);
      return updateTemplateQuestion(db, s(args, "template_id")!, s(args, "question_id")!, input);
    },
  },
  {
    name: "planner_event_edit",
    description: "Edit the planner on an event: add or update a section, or add or update a question. This is the event plan, not the template library.",
    scopes: ["write.planning"],
    confirm: false,
    inputSchema: obj({
      action: { type: "string", enum: ["add_section", "update_section", "add_question", "update_question"] },
      event_id: UUID,
      section_id: UUID,
      question_id: UUID,
      title: STR,
      section_type: { type: "string" },
      after_sort_order: { type: "integer" },
      settings_json: STR,
      prompt: STR,
      answer_type: STR,
      options_json: STR,
      required: { type: "boolean" },
    }, ["action", "event_id"]),
    async execute(args, ctx) {
      const db = adminOf(ctx) as unknown as EditorDb;
      const action = s(args, "action");
      if (action === "add_section") {
        return addEventSection(db, s(args, "event_id")!, { title: s(args, "title"), section_type: s(args, "section_type"), after_sort_order: n(args, "after_sort_order") });
      }
      if (action === "update_section") return updateEventSection(db, s(args, "event_id")!, s(args, "section_id")!, json(args, "settings_json", {}));
      const input = { prompt: s(args, "prompt"), answer_type: s(args, "answer_type") ?? undefined, options: s(args, "options_json") ? json(args, "options_json", []) : undefined, required: args.required === true };
      if (action === "add_question") return addEventQuestion(db, s(args, "event_id")!, s(args, "section_id")!, input);
      return updateEventQuestion(db, s(args, "event_id")!, s(args, "question_id")!, input);
    },
  },
  {
    name: "venues_contact",
    description: "Add or remove a contact on a venue. Removal only deletes a contact that belongs to that venue.",
    scopes: ["write.venues"],
    confirm: false,
    inputSchema: obj({ action: { type: "string", enum: ["add", "remove"] }, venue_id: UUID, contact_id: UUID, name: STR, role: STR, phone: STR, email: STR }, ["action", "venue_id"]),
    async execute(args, ctx) {
      const db = adminOf(ctx) as unknown as EditorDb;
      if (s(args, "action") === "remove") return removeContact(db, "venue_contacts", "venue_id", s(args, "venue_id")!, s(args, "contact_id")!);
      return addContact(db, "venue_contacts", "venue_id", s(args, "venue_id")!, { name: s(args, "name"), role: s(args, "role"), phone: s(args, "phone"), email: s(args, "email") });
    },
  },
  {
    name: "vendors_contact",
    description: "Add or remove a contact on a vendor. Removal only deletes a contact that belongs to that vendor.",
    scopes: ["write.vendors"],
    confirm: false,
    inputSchema: obj({ action: { type: "string", enum: ["add", "remove"] }, vendor_id: UUID, contact_id: UUID, name: STR, role: STR, phone: STR, email: STR }, ["action", "vendor_id"]),
    async execute(args, ctx) {
      const db = adminOf(ctx) as unknown as EditorDb;
      if (s(args, "action") === "remove") return removeContact(db, "vendor_contacts", "vendor_id", s(args, "vendor_id")!, s(args, "contact_id")!);
      return addContact(db, "vendor_contacts", "vendor_id", s(args, "vendor_id")!, { name: s(args, "name"), role: s(args, "role"), phone: s(args, "phone"), email: s(args, "email") });
    },
  },
  {
    name: "spotify_sync_event",
    description: "Reconcile planner sections that already store a Spotify user and playlist. This does not start an OAuth login. Sections with no stored connection are skipped.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async execute(args, ctx) {
      const { syncEventSections } = await import("@/lib/spotifySync");
      await syncEventSections(adminOf(ctx) as never, s(args, "event_id")!);
      return { ok: true, oauth_started: false };
    },
  },
  {
    name: "spotify_export",
    description: "Create playlists on a staff Spotify account that is already connected. Pass that account user id. If it is not connected or cannot write, nothing is created and no login is started.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({
      event_id: UUID,
      staff_auth_user_id: UUID,
      picks_json: { type: "string", minLength: 2 },
    }, ["event_id", "staff_auth_user_id", "picks_json"]),
    async execute(args, ctx) {
      const { getSpotifyConnection, createSpotifyPlaylist, addTracksToSpotifyPlaylist } = await import("@/lib/spotifyAuth");
      const userId = s(args, "staff_auth_user_id")!;
      const gate = spotifyExistingConnection(await getSpotifyConnection(userId));
      if (!gate.ok) return { ok: false, reason: gate.reason, oauth_started: false };
      const picks = json<{ sectionId: string; trackIds: string[] }[]>(args, "picks_json", []);
      const admin = adminOf(ctx);
      const event = await query(admin.from("events").select("name, event_date").eq("id", s(args, "event_id")).maybeSingle()) as { name?: string; event_date?: string | null } | null;
      if (!event) throw new Error("Event not found.");
      const results = [];
      for (const pick of picks.filter((item) => item.trackIds?.length)) {
        const section = await query(admin.from("planning_sections").select("title").eq("id", pick.sectionId).eq("event_id", s(args, "event_id")).maybeSingle()) as { title?: string } | null;
        if (!section) continue;
        const title = section.title ?? "Moment";
        const created = await createSpotifyPlaylist(userId, `${event.name ?? "Event"} - ${title}`, `Exported from XOS`);
        if ("error" in created) {
          results.push({ section: title, error: created.error });
          continue;
        }
        const added = await addTracksToSpotifyPlaylist(userId, created.id, pick.trackIds.map((id) => `spotify:track:${id}`));
        results.push({ section: title, added: added ? pick.trackIds.length : 0 });
      }
      return { ok: true, oauth_started: false, results };
    },
  },
  {
    name: "notifications_update",
    description: "Turn a notification audience email or SMS channel on or off.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ setting_id: UUID, email: { type: "boolean" }, sms: { type: "boolean" }, is_enabled: { type: "boolean" } }, ["setting_id"]),
    async execute(args, ctx) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const key of ["email", "sms", "is_enabled"]) if (key in args) patch[key] = args[key];
      const { error } = await adminOf(ctx).from("notification_settings").update(patch).eq("id", s(args, "setting_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "journeys_save",
    description: "Create or rename a client journey type.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ journey_id: UUID, name: { type: "string", minLength: 1 } }, ["name"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      if (s(args, "journey_id")) {
        const { error } = await admin.from("journey_types").update({ name: s(args, "name") }).eq("id", s(args, "journey_id"));
        if (error) throw new Error(error.message);
        return { id: s(args, "journey_id") };
      }
      const created = await query(admin.from("journey_types").insert({ name: s(args, "name") }).select("id").single()) as { id: string };
      return { id: created.id };
    },
  },
  {
    name: "dashboard_layout_save",
    description: "Save the dashboard widget layout for one staff role. The widget list is checked against the registry.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ role: { type: "string", enum: ["master_admin", "admin", "salesperson", "employee", "marketing"] }, widgets_json: STR }, ["role", "widgets_json"]),
    async execute(args, ctx) {
      const widgets = sanitizeLayout(json(args, "widgets_json", []));
      const { error } = await adminOf(ctx).from("dashboard_layouts").upsert({ role: s(args, "role") as Role, widgets, updated_at: new Date().toISOString() }, { onConflict: "role" });
      if (error) throw new Error(error.message);
      return { ok: true, widgets };
    },
  },
  {
    name: "expense_categories_add",
    description: "Add an expense category used by event expenses.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ name: { type: "string", minLength: 1 } }, ["name"]),
    async execute(args, ctx) {
      const row = await query(adminOf(ctx).from("expense_categories").upsert({ name: s(args, "name") }, { onConflict: "name" }).select("id").single()) as { id: string };
      return { id: row.id };
    },
  },
  {
    name: "packages_weekday_prices",
    description: "Set a package weekday price for Sunday through Saturday. A blank day clears that override. This replaces the weekday price map.",
    scopes: ["write.catalog"],
    confirm: true,
    inputSchema: obj({ package_id: UUID, prices_json: STR }, ["package_id", "prices_json"]),
    async execute(args, ctx) {
      return saveWeekdayPrices(adminOf(ctx) as unknown as EditorDb, s(args, "package_id")!, json(args, "prices_json", {}));
    },
  },
  {
    name: "helpers_button",
    description: "Set a booking helper button label, colors, font size, and font weight.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ helper_id: UUID, button_text: STR, button_bg: STR, button_fg: STR, button_font_size: { type: "integer" }, button_font_weight: { type: "integer" } }, ["helper_id", "button_text"]),
    async execute(args, ctx) {
      return saveHelperButton(adminOf(ctx) as unknown as EditorDb, s(args, "helper_id")!, args);
    },
  },
  {
    name: "document_template_blocks",
    description: "Replace the blocks on a document template. Text and section blocks keep their html. Smart blocks are fee table, payment schedule, event details, signature, and divider.",
    scopes: ["write.documents"],
    confirm: true,
    inputSchema: obj({ template_id: UUID, name: STR, blocks_json: STR }, ["template_id", "blocks_json"]),
    async execute(args, ctx) {
      return saveDocumentBlocks(adminOf(ctx) as unknown as EditorDb, s(args, "template_id")!, json(args, "blocks_json", []), s(args, "name"));
    },
  },
  {
    name: "photobooth_backdrops",
    description: "Create or rename a photo booth backdrop. The image itself is uploaded with events_file_upload as bounded base64 or a staged event path.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ backdrop_id: UUID, name: STR, category: STR, is_active: { type: "boolean" } }, ["name"]),
    async execute(args, ctx) {
      return saveBackdrop(adminOf(ctx) as unknown as EditorDb, s(args, "backdrop_id"), args);
    },
  },
  {
    name: "briefing_prefs",
    description: "Set whether one employee gets the staff briefing and how often. This does not send the briefing.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ employee_id: UUID, enabled: { type: "boolean" }, frequency: { type: "string", enum: ["daily", "weekdays", "weekly"] } }, ["employee_id"]),
    async execute(args, ctx) {
      return saveBriefingPref(adminOf(ctx) as unknown as EditorDb, s(args, "employee_id")!, args);
    },
  },
  {
    name: "assistant_articles",
    description: "Create or update an assistant knowledge article. Running an AI task that emails people is not this tool.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ article_id: UUID, title: STR, content: STR, category: STR }, ["title"]),
    async execute(args, ctx) {
      return saveArticle(adminOf(ctx) as unknown as EditorDb, s(args, "article_id"), args);
    },
  },
  {
    name: "settings_general_update",
    description: "Update the company name and timezone. This does not change vendor API keys.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ company_name: STR, timezone: STR }, []),
    async execute(args, ctx) {
      const patch: Record<string, unknown> = {};
      if (s(args, "company_name")) patch.company_name = s(args, "company_name");
      if (s(args, "timezone")) patch.timezone = s(args, "timezone");
      const { error } = await adminOf(ctx).from("company_settings").update(patch).eq("id", true);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
];

const COVERAGE_READS = new Set<string>([]);
for (const tool of coverageTools) {
  if (!COVERAGE_READS.has(tool.name)) tool.writes = true;
}

async function scheduledComm(admin: SupabaseClient, eventId: string, templateId: string, targetDate: string, action: "skip" | "undo" | "mark_sent", actor: string) {
  const ctx = await loadOccurrence(admin, eventId, templateId, targetDate);
  if (action === "undo") {
    if (ctx.run?.status !== "skipped") throw new Error("This is not skipped.");
    const { error } = await admin.from("scheduled_email_runs").update({ status: "pending", acted_by_name: null, acted_at: null }).eq("template_id", templateId).eq("event_id", eventId).eq("target_date", targetDate).eq("status", "skipped");
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  if (ctx.run?.status === "sent" || ctx.run?.status === "marked_sent") throw new Error("This one already went out.");
  if (ctx.computed !== targetDate) throw new Error("The send date changed. Ask for a fresh preview.");
  const status = action === "skip" ? "skipped" : "marked_sent";
  const stamp = { status, acted_by_name: actor, acted_at: new Date().toISOString(), sent_at: null };
  const { error } = ctx.run
    ? await admin.from("scheduled_email_runs").update(stamp).eq("template_id", templateId).eq("event_id", eventId).eq("target_date", targetDate)
    : await admin.from("scheduled_email_runs").insert({ template_id: templateId, event_id: eventId, target_date: targetDate, ...stamp });
  if (error) throw new Error(error.message);
  return { ok: true, status };
}

async function saveScheduledOverride(admin: SupabaseClient, eventId: string, templateId: string, targetDate: string, subject: string | null, body: string, actor: string) {
  const ctx = await loadOccurrence(admin, eventId, templateId, targetDate);
  if (ctx.run?.status === "sent" || ctx.run?.status === "marked_sent") throw new Error("This one already went out.");
  if (ctx.computed !== targetDate) throw new Error("The send date changed. Ask for a fresh preview.");
  const edit = { override_subject: ctx.template.isSms ? null : subject, override_body_html: body, edited_by_name: actor, edited_at: new Date().toISOString() };
  const { error } = ctx.run
    ? await admin.from("scheduled_email_runs").update(edit).eq("template_id", templateId).eq("event_id", eventId).eq("target_date", targetDate)
    : await admin.from("scheduled_email_runs").insert({ template_id: templateId, event_id: eventId, target_date: targetDate, status: "pending", ...edit });
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function loadOccurrence(admin: SupabaseClient, eventId: string, templateId: string, targetDate: string) {
  const [{ data: tpl }, { data: event }, { data: settings }, { data: run }] = await Promise.all([
    admin.from("email_templates").select(SCHEDULE_TEMPLATE_COLUMNS).eq("id", templateId).maybeSingle(),
    admin.from("events").select("event_date, booked_date, initial_contact_date, contract_sent_date, contract_due_date, contract_signed_date, quote_sent_date").eq("id", eventId).maybeSingle(),
    admin.from("company_settings").select("timezone").eq("id", true).maybeSingle(),
    admin.from("scheduled_email_runs").select("status").eq("template_id", templateId).eq("event_id", eventId).eq("target_date", targetDate).maybeSingle(),
  ]);
  if (!tpl || !event) throw new Error("That scheduled message is no longer available.");
  const template = mapTemplate(tpl as TemplateRow);
  if (!template) throw new Error("That template is not on a schedule.");
  const anchors: AnchorDates = {
    eventDate: event.event_date,
    bookedDate: event.booked_date,
    initialContactDate: event.initial_contact_date,
    contractSentDate: event.contract_sent_date,
    contractDueDate: event.contract_due_date,
    contractSignedDate: event.contract_signed_date,
    quoteSentDate: event.quote_sent_date,
  };
  return { template, run: run as { status: string } | null, computed: targetDateFor(template, anchors), today: zonedParts(new Date(), settings?.timezone || "America/New_York").date };
}

async function applyVendorSuggestion(admin: SupabaseClient, id: string) {
  const suggestion = await query(admin.from("vendor_match_suggestions").select("*").eq("id", id).maybeSingle()) as {
    status: string; proposed: { corrected_name?: string; contact_name?: string; contact_phone?: string; contact_email?: string } | null;
    event_vendor_id: string; kind: string; matched_vendor_id: string | null;
  } | null;
  if (!suggestion || suggestion.status !== "pending") throw new Error("That suggestion is not pending.");
  const proposed = suggestion.proposed ?? {};
  const ev = await query(admin.from("event_vendors").select("id, vendor_id, contact_name, contact_phone, contact_email").eq("id", suggestion.event_vendor_id).maybeSingle()) as {
    id: string; vendor_id: string; contact_name: string | null; contact_phone: string | null; contact_email: string | null;
  } | null;
  if (!ev) {
    await admin.from("vendor_match_suggestions").update({ status: "dismissed" }).eq("id", id);
    return { ok: true, dismissed: true };
  }
  const evUpdate: Record<string, string> = {};
  if (proposed.contact_name && !ev.contact_name) evUpdate.contact_name = proposed.contact_name;
  if (proposed.contact_phone && !ev.contact_phone) evUpdate.contact_phone = proposed.contact_phone;
  if (proposed.contact_email && !ev.contact_email) evUpdate.contact_email = proposed.contact_email;
  if (suggestion.kind === "merge" && suggestion.matched_vendor_id && suggestion.matched_vendor_id !== ev.vendor_id) {
    const { error } = await admin.from("event_vendors").update({ ...evUpdate, vendor_id: suggestion.matched_vendor_id }).eq("id", ev.id);
    if (error) throw new Error(error.message);
  } else if (Object.keys(evUpdate).length) {
    const { error } = await admin.from("event_vendors").update(evUpdate).eq("id", ev.id);
    if (error) throw new Error(error.message);
    if (proposed.corrected_name && ev.vendor_id) await admin.from("vendors").update({ company_name: proposed.corrected_name }).eq("id", ev.vendor_id);
  }
  await admin.from("vendor_match_suggestions").update({ status: "applied" }).eq("id", id);
  return { ok: true };
}
