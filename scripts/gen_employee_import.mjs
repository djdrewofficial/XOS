// One-off: enrich existing XOS employees from the DJEP employee CSV export.
// Employees already exist (linked by legacy_djep_id) — this only BACKFILLS blank
// fields and the four new columns Drew approved. Never overwrites existing data,
// never touches pay/commission, permissions, or is_active.
import fs from "node:fs";

const CSV = "C:/Users/thedr/Downloads/24975_djemployee (1).csv";
const OUT = "C:/Users/thedr/Projects/xos/supabase/migrations/00095_employee_enrichment.sql";

// ---- CSV parser (quoted fields, embedded commas AND newlines) ----
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(CSV, "utf8").replace(/^﻿/, "");
const rows = parseCsv(raw).filter((r) => r.length > 5 && r.some((c) => c.trim() !== ""));
const header = rows.shift();
const idx = (name) => header.indexOf(name);
const col = (r, name) => (r[idx(name)] ?? "").trim();

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
function isoDate(v) {
  const m = (v || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
function normWebsite(v) {
  const w = (v || "").trim();
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : "https://" + w.replace(/^\/+/, "");
}
function year(v) {
  const n = parseInt((v || "").trim(), 10);
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
}

const out = [];
out.push("-- XOS — enrich existing employees from the DJEP employee export.");
out.push("-- Matched by legacy_djep_id; BACKFILLS blanks only (coalesce), so it never");
out.push("-- overwrites edited values and is safe to re-run. Pay/commission, permission");
out.push("-- tier, and is_active are intentionally left untouched (per Drew).");
out.push("");
out.push("alter table employees");
out.push("  add column if not exists middle_name text,");
out.push("  add column if not exists website text,");
out.push("  add column if not exists employment_type text,");
out.push("  add column if not exists planning_meeting_url text;");
out.push("");

// existing columns get coalesce(nullif(col,''), new); new columns same form
const FIELDS = [
  // [db_column, csv_column, transform]
  ["email", "Email", (v) => v || null],                            // fill blanks only (2 employees null)
  ["phone", "Cell Phone", (v) => v || null],                       // fill blanks only (Drew: Cell)
  ["bio", "Biography", (v) => v || null],
  ["notes", "Notes", (v) => v || null],
  ["profession_since", "Year Began", year, "raw"],                 // integer
  ["birthday", "Birthday", isoDate, "date"],                       // date
  ["stage_name", "Stage Name", (v) => v || null],
  ["photo_path", "Profile Image URL", (v) => v || null],
  ["emergency_contact", "Emergency Contact", (v) => v || null],
  ["middle_name", "Employee Middle Name", (v) => v || null],
  ["website", "Website", normWebsite],
  ["employment_type", "Type Of Employment", (v) => v || null],
  ["planning_meeting_url", "Calendly Planning Meeting", (v) => v || null],
];

let n = 0, skipped = 0;
const ids = [];
for (const r of rows) {
  const legacy = col(r, "Employee ID");
  if (!legacy) { skipped++; continue; }
  ids.push(legacy);

  const sets = [];
  for (const [dbCol, csvCol, tx, kind] of FIELDS) {
    const val = tx(col(r, csvCol));
    if (val == null || val === "") continue;
    if (kind === "raw") sets.push(`  ${dbCol} = coalesce(${dbCol}, ${val})`);
    else if (kind === "date") sets.push(`  ${dbCol} = coalesce(${dbCol}, ${q(val)}::date)`);
    else sets.push(`  ${dbCol} = coalesce(nullif(${dbCol}, ''), ${q(val)})`);
  }
  if (!sets.length) continue;
  n++;
  out.push(`-- ${col(r, "Employee First Name")} ${col(r, "Employee Last Name")} (${legacy})`);
  out.push("update employees set");
  out.push(sets.join(",\n"));
  out.push(`where legacy_djep_id = ${q(legacy)};`);
  out.push("");
}

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log(`csv_rows=${rows.length} updates=${n} skipped_no_id=${skipped}`);
console.log(`legacy_ids=${ids.join(",")}`);
