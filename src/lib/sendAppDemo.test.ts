import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SEND_APP_DEMO_EMAIL,
  SEND_APP_DEMO_EMAIL_TEMPLATE_ID,
  SEND_APP_DEMO_SMS,
  SEND_APP_DEMO_SMS_TEMPLATE_ID,
  XPRESS_IOS_APP_STORE_URL,
  demoModeBannerCopy,
} from "./demoModeCopy.ts";
import {
  helperHasDemoModeOff,
  helperHasDemoModeOn,
  helperHasSendAppDemo,
  parseDemoDisableMode,
} from "./demoModeHelperActions.ts";
import { placeAppStoreLink, placeJoinLinkTags } from "./eventAccess.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("demo mode visibility copy", () => {
  it("warns clients not to enter real info and mentions Booking Agreement auto-off", () => {
    const client = demoModeBannerCopy("client");
    assert.match(client.en, /demo mode/i);
    assert.match(client.en, /do not enter real/i);
    assert.match(client.en, /Booking Agreement/);
    assert.match(client.es, /modo demo/i);
    assert.match(client.es, /Acuerdo de Reserva/);
  });

  it("keeps staff copy focused on sample data", () => {
    const staff = demoModeBannerCopy("staff");
    assert.match(staff.en, /Sample planning/);
    assert.match(staff.en, /Booking Agreement/);
  });
});

describe("Send App Demo defaults", () => {
  it("uses the official iPhone App Store URL and never mentions Android / Play", () => {
    assert.equal(XPRESS_IOS_APP_STORE_URL, "https://apps.apple.com/us/app/xpress-entertainment/id6788780432");
    const blob = `${SEND_APP_DEMO_EMAIL.bodyHtml}\n${SEND_APP_DEMO_SMS.bodyHtml}\n${XPRESS_IOS_APP_STORE_URL}`;
    assert.doesNotMatch(blob, /[Gg]oogle Play|[Aa]ndroid|play\.google/);
    assert.match(SEND_APP_DEMO_EMAIL.bodyHtml, /app_host_link/);
    assert.match(SEND_APP_DEMO_EMAIL.bodyHtml, /app_store_link/);
    assert.match(SEND_APP_DEMO_SMS.bodyHtml, /app_host_link/);
  });

  it("ships stable template ids used by migration 00240", () => {
    const mig = read("supabase/migrations/00240_demo_mode_helper_actions.sql");
    assert.match(mig, new RegExp(SEND_APP_DEMO_EMAIL_TEMPLATE_ID));
    assert.match(mig, new RegExp(SEND_APP_DEMO_SMS_TEMPLATE_ID));
    assert.match(mig, /Send App Demo/);
    assert.match(mig, /demo_mode_on/);
    assert.match(mig, /demo_mode_off/);
    assert.match(mig, /send_app_demo/);
    assert.match(mig, /event_guest_card/);
    assert.match(mig, /e\.demo_mode/);
    assert.match(mig, /app_store_link/);
    // Must NOT mutate After Sign helper in production data (only document an opt-in example).
    assert.doesNotMatch(mig, /^update\s+booking_helpers/m);
    assert.match(mig, /DATA CHANGE \(opt-in/);
    assert.match(mig, /keep_client/);
    assert.match(mig, /d9d2c968-737f-4cfb-8c3c-2ce711ce894e/);
  });
});

describe("demo helper action parsing", () => {
  it("defaults demo_mode_off to keep_client", () => {
    assert.equal(parseDemoDisableMode(undefined), "keep_client");
    assert.equal(parseDemoDisableMode("keep_client"), "keep_client");
    assert.equal(parseDemoDisableMode("clean_slate"), "clean_slate");
    assert.equal(parseDemoDisableMode("weird"), "keep_client");
  });

  it("detects on / off / send_app_demo actions", () => {
    assert.equal(helperHasDemoModeOn([{ type: "demo_mode_on" }]), true);
    assert.equal(helperHasDemoModeOn([{ type: "send_app_demo" }]), true);
    assert.equal(helperHasDemoModeOff([{ type: "demo_mode_off", mode: "keep_client" }]), true);
    assert.equal(helperHasSendAppDemo([{ type: "send_app_demo" }]), true);
    assert.equal(helperHasSendAppDemo([{ type: "demo_mode_on" }]), false);
  });
});

describe("app store merge tag", () => {
  it("replaces angled, escaped, and percent-encoded tags", () => {
    const url = XPRESS_IOS_APP_STORE_URL;
    assert.equal(placeAppStoreLink("Get it: <app_store_link>", url), `Get it: ${url}`);
    assert.equal(placeAppStoreLink("Get it: &lt;app_store_link&gt;", url), `Get it: ${url}`);
    assert.equal(
      placeJoinLinkTags("<app_host_link> / <app_store_link>", { host: "https://xos.example/j/abc" }),
      "https://xos.example/j/abc / <app_store_link>",
    );
  });
});

describe("wiring: visibility + Send App Demo surfaces", () => {
  it("exposes demoMode on join describe, mobile event card, and guest card select", () => {
    const join = read("src/lib/eventAccessServer.ts");
    assert.match(join, /demoMode: Boolean/);
    const page = read("src/app/j/[token]/page.tsx");
    assert.match(page, /DemoModeBanner/);
    assert.match(page, /bilingual/);
    assert.match(page, /audience="client"/);
    const mobile = read("src/app/api/mobile/events/[eventId]/route.ts");
    assert.match(mobile, /demoMode:/);
    assert.match(mobile, /demo_mode/);
    const portal = read("src/app/portal/plan/[eventId]/page.tsx");
    assert.match(portal, /demo_mode/);
    assert.match(portal, /DemoModeBanner/);
  });

  it("wires Send App Demo through MCP, staff action, and helper runner", () => {
    const office = read("src/lib/mcp/tools/office.ts");
    assert.match(office, /events_send_app_demo/);
    const toolBlock = office.slice(
      office.indexOf('name: "events_send_app_demo"'),
      office.indexOf('name: "events_set_demo_mode"'),
    );
    assert.match(toolBlock, /confirm:\s*true/);
    assert.match(toolBlock, /comms\.email/);
    assert.match(toolBlock, /comms\.sms/);
    assert.match(toolBlock, /sendAppDemo/);
    assert.match(toolBlock, /iPhone App Store/);
    assert.doesNotMatch(toolBlock, /play\.google/);

    const actions = read("src/app/(app)/events/demoModeActions.ts");
    assert.match(actions, /sendAppDemo/);
    const ui = read("src/components/EventDemoMode.tsx");
    assert.match(ui, /Send App Demo/);
    assert.doesNotMatch(ui, /\u2014/);

    const runner = read("src/lib/bookingHelperRun.ts");
    assert.match(runner, /applyDemoModeHelperActionsBefore/);
    assert.match(runner, /applyDemoModeHelperActionsAfter/);
    const automations = read("src/lib/automations.ts");
    assert.match(automations, /applyDemoModeHelperActionsBefore/);
    assert.match(automations, /applyDemoModeHelperActionsAfter/);

    const helperActions = read("src/app/(app)/settings/helpers/actions.ts");
    assert.match(helperActions, /demo_mode_on/);
    assert.match(helperActions, /demo_mode_off/);
    assert.match(helperActions, /send_app_demo/);
  });

  it("enableEventDemoMode skips cancelled / lost-sale / archived events", () => {
    const lib = read("src/lib/demoMode.ts");
    assert.match(lib, /is_lost_sale_group/);
    assert.match(lib, /Cancelled/);
    assert.match(lib, /archived_at/);
    assert.match(lib, /CANCELLED/);
  });

  it("calls enableEventDemoMode and leaves template-based seeding intact", () => {
    // PR 94 seeds from the event planning template — do not reintroduce hardcoded sections.
    const lib = read("src/lib/demoMode.ts");
    assert.match(lib, /resolveDemoPlanningTemplateId/);
    assert.match(lib, /seedPlanningSkeletonFromTemplate/);
    assert.doesNotMatch(lib, /DEMO_SECTIONS|DEMO_QUESTIONS/);
    const send = read("src/lib/sendAppDemo.ts");
    assert.match(send, /enableEventDemoMode/);
    assert.doesNotMatch(send, /seedDemoPlanning|DEMO_SECTIONS|wipeEventPlanning|seedPlanningSkeletonFromTemplate/);
  });
});
