#!/usr/bin/env node
/* Storage backup (see docs/db-recovery-runbook.md §2). The Postgres backup does
   NOT include Storage buckets, so a DB restore won't bring back signed contracts
   or photos. This writes a manifest of every object in every bucket and downloads
   the critical bucket(s) (default: event-files = signed contracts / generated PDFs)
   to backups/storage/<timestamp>/. Pass --all to also download photos/media (large).
   Git-ignored output.

   Usage:
     export NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co"
     export SUPABASE_SERVICE_ROLE_KEY="<service-role key>"
     npm run db:storage-snapshot            # manifest all + download event-files
     npm run db:storage-snapshot -- --all   # also download every bucket
*/
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — see docs/db-recovery-runbook.md §2.");
  process.exit(1);
}

const downloadAll = process.argv.includes("--all");
// The irreplaceable, legally-important bucket: signed contracts / generated PDFs.
const CRITICAL = new Set(["event-files"]);

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const base = join(root, "backups", "storage", stamp);
mkdirSync(base, { recursive: true });

/** Recursively list every object path under a bucket (folders have id === null). */
async function listAll(bucket, prefix = "") {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        out.push(...(await listAll(bucket, path))); // folder → recurse
      } else {
        out.push({ path, size: item.metadata?.size ?? null, updated_at: item.updated_at ?? null });
      }
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return out;
}

async function download(bucket, path) {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`download ${bucket}/${path}: ${error?.message ?? "no data"}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const dest = join(base, bucket, ...path.split("/"));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf.length;
}

try {
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error) throw new Error(error.message);
  const manifest = {};
  let downloaded = 0;
  let bytes = 0;
  for (const b of buckets ?? []) {
    process.stdout.write(`• ${b.name}: listing… `);
    const objects = await listAll(b.name);
    manifest[b.name] = objects;
    console.log(`${objects.length} object(s)`);
    if (downloadAll || CRITICAL.has(b.name)) {
      for (const o of objects) {
        bytes += await download(b.name, o.path);
        downloaded++;
      }
      console.log(`  ↳ downloaded ${objects.length} object(s) from ${b.name}`);
    }
  }
  writeFileSync(join(base, "manifest.json"), JSON.stringify({ stamp, buckets: manifest }, null, 2));
  console.log(`✓ storage snapshot: ${base}`);
  console.log(`  manifest: all buckets · downloaded ${downloaded} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  if (!downloadAll) console.log(`  (only ${[...CRITICAL].join(", ")} downloaded — pass --all to include photos/media)`);
} catch (e) {
  console.error("Storage snapshot failed:", e?.message || e);
  process.exit(1);
}
