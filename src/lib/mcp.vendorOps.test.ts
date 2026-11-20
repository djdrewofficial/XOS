import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EVENT_VENDOR_ROLE_EXAMPLES,
  VENDOR_CONTACTS_EMBED,
  VENDOR_LIST_SELECT,
  VENDOR_TABLE_COLUMNS,
  VENDOR_WRITABLE_COLUMNS,
  assertVendorPayloadColumns,
  createVendor,
  listVendors,
  updateVendor,
} from "./mcp/vendorOps.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const VENDOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Op = {
  table: string;
  kind: "select" | "insert" | "update" | "delete";
  select?: string;
  payload?: Record<string, unknown>;
  filters: { op: string; args: unknown[] }[];
};

function mockAdmin(opts?: {
  vendors?: Record<string, unknown>[];
  contacts?: Record<string, unknown>[];
}) {
  const vendors = structuredClone(opts?.vendors ?? [{ id: VENDOR_ID, company_name: "Lens Co", category: "Photographer" }]);
  const contacts = structuredClone(opts?.contacts ?? []);
  const ops: Op[] = [];

  function tableRows(table: string) {
    if (table === "vendors") return vendors;
    if (table === "vendor_contacts") return contacts;
    throw new Error(`unexpected table ${table}`);
  }

  function api(table: string, kind: Op["kind"], payload?: Record<string, unknown>) {
    const op: Op = { table, kind, payload, filters: [] };
    ops.push(op);
    const chain: Record<string, unknown> = {};
    const finish = async () => {
      if (kind === "insert") {
        const row = { id: table === "vendors" ? VENDOR_ID : CONTACT_ID, ...payload };
        tableRows(table).push(row);
        return { data: row, error: null };
      }
      if (kind === "update") {
        const rows = tableRows(table);
        const match = rows.find((row) =>
          op.filters.every((f) => f.op !== "eq" || row[f.args[0] as string] === f.args[1]),
        );
        if (match && payload) Object.assign(match, payload);
        return { data: match ?? null, error: null };
      }
      let rows = [...tableRows(table)];
      for (const filter of op.filters) {
        if (filter.op === "eq") {
          rows = rows.filter((row) => row[filter.args[0] as string] === filter.args[1]);
        }
      }
      return { data: rows, error: null };
    };
    Object.assign(chain, {
      select(cols: string) {
        op.select = cols;
        return chain;
      },
      insert(row: Record<string, unknown>) {
        return api(table, "insert", row);
      },
      update(row: Record<string, unknown>) {
        return api(table, "update", row);
      },
      delete() {
        return api(table, "delete");
      },
      eq(column: string, value: unknown) {
        op.filters.push({ op: "eq", args: [column, value] });
        return chain;
      },
      or(expr: string) {
        op.filters.push({ op: "or", args: [expr] });
        return chain;
      },
      ilike(column: string, value: string) {
        op.filters.push({ op: "ilike", args: [column, value] });
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      single: finish,
      maybeSingle: async () => {
        const { data, error } = await finish();
        return { data: Array.isArray(data) ? data[0] ?? null : data, error };
      },
      then(resolve: (value: { data: unknown; error: null }) => void, reject?: (err: unknown) => void) {
        finish().then(resolve, reject);
      },
    });
    return chain;
  }

  return {
    ops,
    admin: {
      from(table: string) {
        return api(table, "select");
      },
    },
  };
}

function vendorInserts(ops: Op[]) {
  return ops.filter((op) => op.table === "vendors" && op.kind === "insert");
}

function vendorUpdates(ops: Op[]) {
  return ops.filter((op) => op.table === "vendors" && op.kind === "update");
}

function vendorSelects(ops: Op[]) {
  return ops.filter((op) => op.table === "vendors" && op.kind === "select" && op.select);
}

describe("MCP vendorOps schema alignment", () => {
  it("lists real vendor columns and embeds contacts via the vendor_id FK", () => {
    for (const col of ["email", "phone"]) {
      assert.equal((VENDOR_TABLE_COLUMNS as readonly string[]).includes(col), false);
      assert.equal((VENDOR_WRITABLE_COLUMNS as readonly string[]).includes(col), false);
      assert.doesNotMatch(VENDOR_LIST_SELECT.replace(/vendor_contacts![^(]*\([^)]*\)/g, ""), new RegExp(`\\b${col}\\b`));
    }
    assert.match(VENDOR_LIST_SELECT, /company_name/);
    assert.match(VENDOR_LIST_SELECT, /vendor_contacts!vendor_contacts_vendor_id_fkey/);
    assert.equal(VENDOR_CONTACTS_EMBED.includes("email"), true);
    assert.ok(EVENT_VENDOR_ROLE_EXAMPLES.includes("Photographer"));
    assert.ok(EVENT_VENDOR_ROLE_EXAMPLES.includes("Wedding Planner"));
  });

  it("vendors_list selects only real columns and never email/phone on vendors", async () => {
    const { admin, ops } = mockAdmin({
      vendors: [{ id: VENDOR_ID, company_name: "Lens Co" }],
      contacts: [{ id: CONTACT_ID, vendor_id: VENDOR_ID, name: "Sam", email: "sam@x.test", phone: "305" }],
    });
    const result = await listVendors(admin as never, { q: "Sam", limit: 10 });
    assert.equal(typeof result.limit, "number");

    const vendorSel = vendorSelects(ops);
    assert.ok(vendorSel.length >= 1);
    for (const op of vendorSel) {
      assert.ok(op.select);
      const withoutEmbed = op.select!.replace(/vendor_contacts![^(]*\([^)]*\)/g, "");
      assert.doesNotMatch(withoutEmbed, /\bemail\b/);
      assert.doesNotMatch(withoutEmbed, /\bphone\b/);
      assert.match(op.select!, /vendor_contacts!vendor_contacts_vendor_id_fkey/);
      assert.match(op.select!, /company_name/);
    }
    const contactSearch = ops.find((op) => op.table === "vendor_contacts" && op.kind === "select");
    assert.ok(contactSearch);
    assert.ok(contactSearch!.filters.some((f) => f.op === "or"));
  });

  it("vendors_create inserts only real vendor columns and stores email/phone on vendor_contacts", async () => {
    const { admin, ops } = mockAdmin({ vendors: [] });
    const created = await createVendor(admin as never, {
      company_name: "Bloom Bar",
      category: "Florist",
      website: "https://bloom.example",
      email: "hello@bloom.example",
      phone: "7865550100",
      contact_name: "Ava",
      contact_role: "Owner",
    });
    assert.equal(created.id, VENDOR_ID);
    assert.equal(created.contact?.email, "hello@bloom.example");

    const inserts = vendorInserts(ops);
    assert.equal(inserts.length, 1);
    assertVendorPayloadColumns(inserts[0].payload!);
    assert.equal(inserts[0].payload!.company_name, "Bloom Bar");
    assert.equal("email" in inserts[0].payload!, false);
    assert.equal("phone" in inserts[0].payload!, false);

    const contactInsert = ops.find((op) => op.table === "vendor_contacts" && op.kind === "insert");
    assert.ok(contactInsert);
    assert.equal(contactInsert!.payload!.vendor_id, VENDOR_ID);
    assert.equal(contactInsert!.payload!.name, "Ava");
    assert.equal(contactInsert!.payload!.email, "hello@bloom.example");
    assert.equal(contactInsert!.payload!.phone, "7865550100");
  });

  it("vendors_create without contact fields skips vendor_contacts", async () => {
    const { admin, ops } = mockAdmin({ vendors: [] });
    const created = await createVendor(admin as never, { company_name: "Solo Rentals", notes: "tables" });
    assert.equal(created.contact, null);
    assert.equal(ops.filter((op) => op.table === "vendor_contacts").length, 0);
    assertVendorPayloadColumns(vendorInserts(ops)[0].payload!);
  });

  it("vendors_update patches vendors without email/phone and upserts primary contact", async () => {
    const { admin, ops } = mockAdmin({
      vendors: [{ id: VENDOR_ID, company_name: "Lens Co" }],
      contacts: [],
    });
    const result = await updateVendor(admin as never, {
      vendor_id: VENDOR_ID,
      company_name: "Lens Co Miami",
      email: "desk@lens.example",
      phone: "3055550199",
      contact_name: "Front Desk",
    });
    assert.equal(result.ok, true);
    assert.equal(result.contact?.email, "desk@lens.example");

    const updates = vendorUpdates(ops);
    assert.equal(updates.length, 1);
    assertVendorPayloadColumns(updates[0].payload!);
    assert.equal(updates[0].payload!.company_name, "Lens Co Miami");
    assert.equal("email" in updates[0].payload!, false);
    assert.equal("phone" in updates[0].payload!, false);

    const contactInsert = ops.find((op) => op.table === "vendor_contacts" && op.kind === "insert");
    assert.ok(contactInsert);
    assert.equal(contactInsert!.payload!.name, "Front Desk");
  });

  it("vendors_update updates an existing primary contact instead of writing vendors.email", async () => {
    const { admin, ops } = mockAdmin({
      vendors: [{ id: VENDOR_ID, company_name: "Lens Co" }],
      contacts: [{ id: CONTACT_ID, vendor_id: VENDOR_ID, name: "Sam", email: "old@x.test" }],
    });
    await updateVendor(admin as never, {
      vendor_id: VENDOR_ID,
      email: "new@x.test",
      phone: "999",
    });
    assert.equal(vendorUpdates(ops).length, 0);
    const contactUpdate = ops.find((op) => op.table === "vendor_contacts" && op.kind === "update");
    assert.ok(contactUpdate);
    assert.equal(contactUpdate!.payload!.email, "new@x.test");
    assert.equal(contactUpdate!.payload!.phone, "999");
  });

  it("office and coverage tools wire through vendorOps and document event roles", () => {
    const office = read("src/lib/mcp/tools/office.ts");
    const coverage = read("src/lib/mcp/tools/coverage.ts");
    assert.match(office, /listVendors\(adminOf\(ctx\), args\)/);
    assert.match(office, /createVendor\(adminOf\(ctx\), args\)/);
    assert.match(office, /contact_name/);
    assert.match(office, /contact_role/);
    assert.doesNotMatch(office, /from\("vendors"\)\.select\("[^"]*\bemail\b/);
    assert.doesNotMatch(office, /from\("vendors"\)\.insert\(\{[^}]*\bemail\b/);
    assert.match(coverage, /updateVendor\(adminOf\(ctx\), args\)/);
    assert.match(coverage, /For add\/remove of extra contacts use vendors_contact/);
    assert.match(coverage, /name: "events_add_vendor"/);
    assert.match(coverage, /Photographer/);
    assert.match(coverage, /Wedding Planner/);
    assert.match(coverage, /event_vendors \(contact_name/);
    assert.doesNotMatch(coverage, /for \(const key of \["company_name", "category", "email", "phone", "notes"\]\)/);
  });
});
