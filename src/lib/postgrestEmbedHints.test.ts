import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * event_staff has two FKs to employees (employee_id + timesheet_approved_by).
 * time_punches has two (employee_id + created_by). Unhinted PostgREST embeds
 * like `employee:employees(...)` return HTTP 300 PGRST201.
 */
const EVENT_STAFF_HINT = "employees!event_staff_employee_id_fkey";
const TIME_PUNCHES_HINT = "employees!time_punches_employee_id_fkey";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = join(root, "src");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** True when `employee:employees(` at `index` is an event_staff / time_punches embed. */
function ambiguousParentContext(src: string, index: number, parent: "event_staff" | "time_punches"): boolean {
  const before = src.slice(Math.max(0, index - 800), index);
  const froms = [...before.matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)];
  const lastFromIdx = froms.length ? before.lastIndexOf(froms[froms.length - 1][0]) : -1;
  const lastFrom = froms.length ? froms[froms.length - 1][1] : null;
  if (lastFrom === parent) return true;

  // Nested resource: event_staff(... employee:employees( inside another table's select.
  const nestToken = `${parent}(`;
  const nestAt = before.lastIndexOf(nestToken);
  if (nestAt < 0) return false;
  // Ignore nests that belong to an earlier query (before the most recent .from).
  if (nestAt < lastFromIdx) return false;
  return !/\.from\s*\(/.test(before.slice(nestAt));
}

function findUnhinted(src: string, parent: "event_staff" | "time_punches"): number[] {
  const hits: number[] = [];
  // Unhinted only — `employee:employees!...` is excluded by the negative lookahead.
  const re = /employee:employees(?!!)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (ambiguousParentContext(src, m.index, parent)) hits.push(m.index);
  }
  return hits;
}

describe("PostgREST employee embed FK hints", () => {
  it("keeps event_staff → employees embeds disambiguated with event_staff_employee_id_fkey", () => {
    const offenders: string[] = [];
    for (const file of walkTs(srcRoot)) {
      const src = readFileSync(file, "utf8");
      for (const idx of findUnhinted(src, "event_staff")) {
        const line = src.slice(0, idx).split("\n").length;
        offenders.push(`${relative(root, file)}:${line}`);
      }
    }
    assert.deepEqual(offenders, [], `Unhinted event_staff→employees embeds (use ${EVENT_STAFF_HINT}): ${offenders.join(", ")}`);
  });

  it("keeps time_punches → employees embeds disambiguated with time_punches_employee_id_fkey when present", () => {
    const offenders: string[] = [];
    for (const file of walkTs(srcRoot)) {
      const src = readFileSync(file, "utf8");
      for (const idx of findUnhinted(src, "time_punches")) {
        const line = src.slice(0, idx).split("\n").length;
        offenders.push(`${relative(root, file)}:${line}`);
      }
    }
    assert.deepEqual(offenders, [], `Unhinted time_punches→employees embeds (use ${TIME_PUNCHES_HINT}): ${offenders.join(", ")}`);
  });

  it("detects a synthetic unhinted event_staff embed", () => {
    const bad = `await db.from("event_staff").select("id, employee:employees(first_name)")`;
    assert.deepEqual(findUnhinted(bad, "event_staff").length, 1);
    const good = `await db.from("event_staff").select("id, employee:${EVENT_STAFF_HINT}(first_name)")`;
    assert.deepEqual(findUnhinted(good, "event_staff"), []);
    const nestedBad = `.from("events").select("event_staff(employee:employees(hourly_rate))")`;
    assert.deepEqual(findUnhinted(nestedBad, "event_staff").length, 1);
    const otherTable = `.from("payroll_payables").select("employee:employees(first_name)")`;
    assert.deepEqual(findUnhinted(otherTable, "event_staff"), []);
    const punchesBad = `.from("time_punches").select("employee:employees(first_name)")`;
    assert.deepEqual(findUnhinted(punchesBad, "time_punches").length, 1);
    const punchesGood = `.from("time_punches").select("employee:${TIME_PUNCHES_HINT}(first_name)")`;
    assert.deepEqual(findUnhinted(punchesGood, "time_punches"), []);
  });
});
