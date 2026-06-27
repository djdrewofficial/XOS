"use client";

import { useState } from "react";
import SaveButton from "@/components/SaveButton";

type Suggestion = {
  tag_key: string;
  label: string;
  group_name: string;
  description: string;
  source_type: string;
  source_value: string;
  note?: string;
};
type Result = {
  match?: { tag_key: string; reason: string } | null;
  suggestion?: Suggestion | null;
  error?: string;
};

const SOURCE_TYPES = [
  ["static", "Static text / link (you type the value)"],
  ["poc_field", "Point of Contact field"],
  ["client_field", "Client field"],
  ["event_field", "Event field"],
  ["company_field", "Company setting"],
];

export default function MergeTagWizard({ addTag }: { addTag: (fd: FormData) => Promise<void> }) {
  const [ask, setAsk] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [copied, setCopied] = useState("");

  async function run() {
    if (!ask.trim()) return;
    setLoading(true);
    setRes(null);
    try {
      const r = await fetch("/api/merge-tag-wizard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: ask }),
      });
      const d = await r.json();
      setRes(r.ok ? d : { error: d.error || "Request failed" });
    } catch (e) {
      setRes({ error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(""), 1500);
  }

  const s = res?.suggestion;
  const isDev = s?.source_type === "needs_dev";

  return (
    <div className="card space-y-3 p-5">
      <div>
        <h2 className="card-title mb-1">✨ Merge Tag Wizard</h2>
        <p className="text-xs text-zinc-500">
          Describe the value you want in an email. If a tag already exists you can copy it; if not, the wizard proposes one to add.
        </p>
      </div>
      <textarea
        value={ask}
        onChange={(e) => setAsk(e.target.value)}
        rows={2}
        placeholder="e.g. the link for the assigned coordinator's planning meeting"
        className="input w-full"
      />
      <button type="button" onClick={run} disabled={loading} className="btn-primary px-5 py-1.5 text-sm">
        {loading ? "Thinking…" : "Ask the Wizard"}
      </button>

      {res?.error && <p className="text-sm text-red-600 dark:text-red-400">{res.error}</p>}

      {res?.match && (
        <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">✓ This tag already exists:</p>
          <div className="mt-2 flex items-center gap-3">
            <code className="rounded bg-black/10 px-2 py-1 font-mono dark:bg-white/10">&lt;{res.match.tag_key}&gt;</code>
            <button type="button" onClick={() => copy(`<${res.match!.tag_key}>`)} className="btn-ghost text-xs">
              {copied === `<${res.match.tag_key}>` ? "Copied!" : "Copy"}
            </button>
          </div>
          {res.match.reason && <p className="mt-2 text-xs text-emerald-700/80 dark:text-emerald-300/70">{res.match.reason}</p>}
        </div>
      )}

      {s && isDev && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          <p className="font-semibold">⚠ This needs a developer first</p>
          <p className="mt-1 text-xs">{s.note || "XOS doesn't store this data yet, so a new field has to be added before a tag can resolve it."}</p>
        </div>
      )}

      {s && !isDev && (
        <form action={addTag} className="space-y-3 rounded-lg border border-brand/30 bg-brand/[0.06] p-4">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">New tag suggestion — review and add:</p>
          {s.note && <p className="text-xs text-zinc-500">{s.note}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-xs">Tag Key</label>
              <input name="tag_key" defaultValue={s.tag_key} className="input w-full font-mono" />
            </div>
            <div>
              <label className="label-xs">Label</label>
              <input name="label" defaultValue={s.label} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Group</label>
              <input name="group_name" defaultValue={s.group_name || "CUSTOM"} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Source Type</label>
              <select name="source_type" defaultValue={s.source_type} className="input w-full">
                {SOURCE_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label-xs">Source Value <span className="text-zinc-400">(the field name, or the static text/link)</span></label>
              <input name="source_value" defaultValue={s.source_value} className="input w-full" />
            </div>
            <div className="sm:col-span-2">
              <label className="label-xs">Description</label>
              <input name="description" defaultValue={s.description} className="input w-full" />
            </div>
          </div>
          <SaveButton className="btn-primary px-5 py-1.5 text-sm" savedLabel="Added">Add This Tag</SaveButton>
        </form>
      )}
    </div>
  );
}
