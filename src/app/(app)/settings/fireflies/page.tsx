import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { firefliesConfigured } from "@/lib/fireflies";
import FirefliesSyncButton from "./FirefliesSyncButton";

export const dynamic = "force-dynamic";

export default async function FirefliesSettingsPage() {
  const supabase = await createClient();
  await requireModule("settings", "edit", { supabase });

  const configured = firefliesConfigured();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://xos.xpressdjs.com";
  const webhookUrl = `${appUrl}/api/fireflies/webhook`;

  const [{ count: total }, { count: linked }, { count: unmatched }] = await Promise.all([
    supabase.from("fireflies_meetings").select("id", { count: "exact", head: true }),
    supabase.from("fireflies_meetings").select("id", { count: "exact", head: true }).not("event_id", "is", null),
    supabase.from("fireflies_meetings").select("id", { count: "exact", head: true }).is("client_id", null),
  ]);

  return (
    <div className="max-w-[900px] space-y-5">
      <div>
        <h1 className="page-title">Fireflies</h1>
        <p className="text-sm text-zinc-500">
          Import call notes, transcripts, and action items from Fireflies.ai. Calls are matched to a client/event by
          participant email; action items become suggested tasks you approve on each event&apos;s Fireflies tab.
        </p>
      </div>

      {/* Connection */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Connection</h2>
          <span
            className={`chip ${configured ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}
          >
            {configured ? "Connected" : "Not connected"}
          </span>
        </div>
        {!configured && (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
            <li>In Fireflies, open <strong>Settings → Developer Settings</strong> and copy your API key.</li>
            <li>In Netlify, add an env var <code>FIREFLIES_API_KEY</code> with that value, then redeploy.</li>
            <li>Come back here — the status will flip to Connected and Sync will work.</li>
          </ol>
        )}
        {configured && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <FirefliesSyncButton />
            <span className="text-xs text-zinc-400">Pulls your 50 most recent meetings and matches them by email.</span>
          </div>
        )}
      </div>

      {/* Webhook */}
      <div className="card p-5">
        <h2 className="card-title">Auto-import (webhook)</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Add this URL as a webhook in Fireflies (<strong>Settings → Developer Settings → Webhooks</strong>) so meetings
          import automatically the moment they finish transcribing:
        </p>
        <code className="mt-2 block break-all rounded-lg bg-zinc-100 p-2 text-xs dark:bg-white/[0.04]">{webhookUrl}</code>
        <p className="mt-2 text-xs text-zinc-400">
          Optional: set <code>FIREFLIES_WEBHOOK_SECRET</code> in Netlify and the same secret in Fireflies to verify
          signatures.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Meetings imported" value={total ?? 0} />
        <Stat label="Linked to an event" value={linked ?? 0} />
        <Stat label="Unmatched (no client)" value={unmatched ?? 0} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}
