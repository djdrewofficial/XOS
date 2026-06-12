// Realtime pipe test: subscribe with service role, mutate a row, report events.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

let got = 0;
const channel = supabase
  .channel("rt-test")
  .on("postgres_changes", { event: "*", schema: "public", table: "hl_messages" }, (p) => {
    got++;
    console.log("EVENT:", p.eventType, p.new?.id ?? "");
  })
  .subscribe(async (status) => {
    console.log("SUBSCRIBE STATUS:", status);
    if (status === "SUBSCRIBED") {
      await supabase
        .from("hl_messages")
        .update({ body: "rt probe " + Math.random().toString(36).slice(2, 8) })
        .eq("id", "xos-realtime-test-001");
      console.log("row updated, waiting for event…");
    }
  });

setTimeout(async () => {
  console.log(got > 0 ? "RESULT: realtime OK" : "RESULT: NO EVENTS (publication missing or realtime off)");
  await supabase.removeChannel(channel);
  process.exit(0);
}, 10000);
