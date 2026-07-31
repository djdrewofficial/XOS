#!/usr/bin/env node
/* Pre-migration database snapshot (see docs/db-recovery-runbook.md §2).
   Dumps schema (+ data by default) to backups/<timestamp>.sql via the Supabase
   CLI, so no local Postgres client tools are needed. Git-ignored output.

   Usage:
     export SUPABASE_DB_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres"
     npm run db:snapshot                # schema + data
     npm run db:snapshot -- --schema-only
*/
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("SUPABASE_DB_URL is not set — see docs/db-recovery-runbook.md §2 for how to get it.");
  process.exit(1);
}

const schemaOnly = process.argv.includes("--schema-only");
const dir = join(root, "backups");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(dir, `${stamp}${schemaOnly ? ".schema" : ""}.sql`);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function dump(extraArgs, label) {
  console.log(`• dumping ${label}…`);
  return execFileSync(npx, ["--yes", "supabase", "db", "dump", "--db-url", dbUrl, ...extraArgs], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512, // 512MB
  });
}

try {
  writeFileSync(out, `-- XOS snapshot ${stamp}\n-- schema\n` + dump([], "schema"));
  if (!schemaOnly) {
    appendFileSync(out, `\n-- data\n` + dump(["--data-only"], "data"));
  }
  console.log(`✓ snapshot written: ${out}`);
} catch (e) {
  console.error("Snapshot failed:", e?.message || e);
  console.error("Check SUPABASE_DB_URL and that the Supabase CLI can reach the database.");
  process.exit(1);
}
