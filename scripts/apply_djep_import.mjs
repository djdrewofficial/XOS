import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const readEnv = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(url, key, { auth: { persistSession: false } });

const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log("upserting", rows.length, "rows...");

let done = 0;
for (let i = 0; i < rows.length; i += 50) {
  const batch = rows.slice(i, i + 50);
  const { error } = await supabase.from("email_templates").upsert(batch, { onConflict: "legacy_djep_id" });
  if (error) { console.error("BATCH FAIL @", i, error); process.exit(1); }
  done += batch.length;
  console.log("  upserted", done);
}

const { count } = await supabase.from("email_templates").select("*", { count: "exact", head: true }).not("legacy_djep_id", "is", null);
console.log("imported rows now in table:", count);
