import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { addEventClientMembership, setEventContractHolder } from "./mcp/eventMembership.ts";
import {
  insertEventWithInquirySource,
  resolveInquirySourceId,
  updateEventWithInquirySource,
} from "./mcp/inquirySource.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const officeSrc = readFileSync(join(root, "src/lib/mcp/tools/office.ts"), "utf8");
const coverageSrc = readFileSync(join(root, "src/lib/mcp/tools/coverage.ts"), "utf8");
const paritySrc = readFileSync(join(root, "src/lib/officeParity.ts"), "utf8");

const EVENT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const SOURCE = "44444444-4444-4444-8444-444444444444";

function sourceDb(rows: { id: string; name: string }[]) {
  return {
    from(table: string) {
      assert.equal(table, "inquiry_sources");
      const filters: { column: string; value: unknown }[] = [];
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return api;
        },
        async maybeSingle() {
          const row = rows.find((item) => filters.every((filter) => (item as Record<string, unknown>)[filter.column] === filter.value));
          return { data: row ?? null, error: null };
        },
      };
      return api;
    },
  };
}

describe("MCP inquiry source resolution", () => {
  it("resolves by id and by exact name, and rejects an unknown name", async () => {
    const admin = sourceDb([{ id: SOURCE, name: "The Knot" }]);
    assert.deepEqual(await resolveInquirySourceId(admin as never, {}), { provided: false });
    assert.deepEqual(await resolveInquirySourceId(admin as never, { inquiry_source_id: SOURCE }), { provided: true, id: SOURCE });
    assert.deepEqual(await resolveInquirySourceId(admin as never, { inquiry_source_name: "The Knot" }), { provided: true, id: SOURCE });
    await assert.rejects(
      () => resolveInquirySourceId(admin as never, { inquiry_source_name: "Unknown Lead" }),
      /Inquiry source named "Unknown Lead" was not found/,
    );
  });

  it("sets inquiry_source_id on create by id and by name, rejects unknown name, and updates an existing event", async () => {
    const sources = [{ id: SOURCE, name: "WeddingWire" }];
    const inserts: Record<string, unknown>[] = [];
    const patches: Record<string, unknown>[] = [];

    function admin() {
      return {
        from(table: string) {
          if (table === "inquiry_sources") return sourceDb(sources).from(table);
          assert.equal(table, "events");
          return {
            insert(row: Record<string, unknown>) {
              inserts.push(row);
              return {
                select() {
                  return {
                    async single() {
                      return { data: { id: EVENT }, error: null };
                    },
                  };
                },
              };
            },
            update(patch: Record<string, unknown>) {
              patches.push(patch);
              return {
                eq() {
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        },
      };
    }

    const byId = await insertEventWithInquirySource(
      admin() as never,
      { client_id: CLIENT, name: "Ada & Bo" },
      { inquiry_source_id: SOURCE },
    );
    assert.equal(byId.inquiry_source_id, SOURCE);
    assert.equal(inserts.at(-1)?.inquiry_source_id, SOURCE);

    const byName = await insertEventWithInquirySource(
      admin() as never,
      { client_id: CLIENT, name: "Ada & Bo" },
      { inquiry_source_name: "WeddingWire" },
    );
    assert.equal(byName.inquiry_source_id, SOURCE);

    await assert.rejects(
      () => insertEventWithInquirySource(admin() as never, { client_id: CLIENT, name: "Ada & Bo" }, { inquiry_source_name: "Nope" }),
      /was not found/,
    );

    const updated = await updateEventWithInquirySource(
      admin() as never,
      EVENT,
      { name: "Ada & Bo" },
      { inquiry_source_name: "WeddingWire" },
    );
    assert.equal(updated.inquiry_source_id, SOURCE);
    assert.equal(patches.at(-1)?.inquiry_source_id, SOURCE);

    assert.match(officeSrc, /insertEventWithInquirySource/);
    assert.match(officeSrc, /updateEventWithInquirySource/);
    assert.match(officeSrc, /inquiry_source_name/);
    assert.match(paritySrc, /inquiry_source_id/);
    assert.match(readFileSync(join(root, "src/lib/mcp/tools/parity.ts"), "utf8"), /events_record/);
  });
});

describe("MCP contract holder membership", () => {
  it("sets and clears the holder through mcp_toggle_contract_holder, and add_client can mark holder", async () => {
    assert.match(coverageSrc, /name: "events_set_contract_holder"/);
    assert.match(coverageSrc, /scopes: \["write\.events"\]/);
    assert.match(coverageSrc, /confirm: false/);
    assert.match(coverageSrc, /setEventContractHolder/);
    assert.match(officeSrc, /contract_holder/);
    assert.match(officeSrc, /addEventClientMembership/);

    const rpcs: { name: string; args: Record<string, unknown> }[] = [];
    const admin = {
      async rpc(name: string, args: Record<string, unknown>) {
        rpcs.push({ name, args });
        if (name === "mcp_add_event_client") return { data: MEMBER, error: null };
        return { data: null, error: null };
      },
      from(table: string) {
        assert.equal(table, "event_clients");
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ count: 1, error: null });
              },
            };
          },
        };
      },
    };

    await setEventContractHolder(admin as never, { eventId: EVENT, eventClientId: MEMBER, contractHolder: true });
    await setEventContractHolder(admin as never, { eventId: EVENT, eventClientId: MEMBER, contractHolder: false });
    assert.deepEqual(
      rpcs.filter((row) => row.name === "mcp_toggle_contract_holder").map((row) => row.args.p_value),
      [true, false],
    );

    rpcs.length = 0;
    const attached = await addEventClientMembership(admin as never, {
      eventId: EVENT,
      clientId: CLIENT,
      contractHolder: true,
    });
    assert.equal(attached.contract_holder, true);
    assert.equal(attached.event_client_id, MEMBER);
    assert.deepEqual(
      rpcs.map((row) => row.name),
      ["mcp_add_event_client", "mcp_toggle_contract_holder"],
    );
    assert.equal(rpcs[1]?.args.p_value, true);
  });
});

describe("MCP helpers_list ordering", () => {
  it("orders booking_helpers by position, not sort_order", () => {
    assert.match(officeSrc, /booking_helpers"\)\.select\("id, title, is_active, actions"\)\.order\("position"\)/);
    assert.doesNotMatch(officeSrc, /from\("booking_helpers"\)[\s\S]{0,120}\.order\("sort_order"\)/);
  });
});
