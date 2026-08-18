"use client";

import { useState } from "react";

/* Event AI panel for the Planning/Notes hub: generate a staff briefing, and ask
   questions grounded in the event's data (planner, staff, package, Fireflies, notes). */

type QA = { q: string; a: string };

export default function EventAI({ eventId, configured }: { eventId: string; configured: boolean }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<QA[]>([]);

  async function call(body: object): Promise<{ ok: boolean; text?: string; error?: string }> {
    const res = await fetch(`/api/events/${eventId}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function genSummary() {
    setSummaryBusy(true);
    setErr(null);
    const r = await call({ mode: "summary" });
    if (r.ok) setSummary(r.text ?? "");
    else setErr(r.error ?? "Failed.");
    setSummaryBusy(false);
  }

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setAsking(true);
    setErr(null);
    setQuestion("");
    const r = await call({ mode: "ask", question: q });
    if (r.ok) setHistory((h) => [...h, { q, a: r.text ?? "" }]);
    else setErr(r.error ?? "Failed.");
    setAsking(false);
  }

  if (!configured) {
    return (
      <div className="card p-5">
        <h2 className="card-title">AI Assistant</h2>
        <p className="mt-1 text-sm text-zinc-500">Add <code>OPENAI_API_KEY</code> in Netlify to enable event summaries and Q&amp;A.</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title">AI Assistant</h2>
        <button onClick={genSummary} disabled={summaryBusy} className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50">
          {summaryBusy ? "Writing…" : summary ? "Regenerate summary" : "Generate event summary"}
        </button>
      </div>

      {err && <div className="mt-2 text-xs text-red-500">{err}</div>}

      {summary && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-white/[0.03] dark:text-zinc-200">
          {summary}
        </div>
      )}

      {/* Q&A */}
      <div className="mt-4">
        <div className="space-y-3">
          {history.map((qa, i) => (
            <div key={i} className="text-sm">
              <div className="font-semibold text-zinc-600 dark:text-zinc-300">Q: {qa.q}</div>
              <div className="mt-0.5 whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">{qa.a}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !asking) ask();
            }}
            placeholder="Ask about this event — e.g. what's the first dance song?"
            className="input flex-1 text-sm"
          />
          <button onClick={ask} disabled={asking || !question.trim()} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50">
            {asking ? "…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
