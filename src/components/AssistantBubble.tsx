"use client";

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRobot, faXmark, faPaperPlane } from "@fortawesome/free-solid-svg-icons";

type Msg = { role: "user" | "assistant"; content: string };

const GREETING: Msg = {
  role: "assistant",
  content: "Hi! I'm your XOS assistant. Ask me anything about the system or how we do things. (I'm in training — the more you add to the Knowledge Base, the sharper I get.)",
};

export default function AssistantBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => m !== GREETING) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setMessages((m) => [...m, { role: "assistant", content: data.reply || "(no response)" }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assistant error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-[60] print:hidden">
      {open && (
        <div className="mb-3 flex h-[32rem] max-h-[78vh] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-zinc-950">
          <div className="flex items-center justify-between bg-gradient-to-r from-brand to-brand-light px-4 py-3 text-white">
            <span className="flex items-center gap-2 font-semibold">
              <FontAwesomeIcon icon={faRobot} /> XOS Assistant
              <span className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">beta</span>
            </span>
            <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-white/20" aria-label="Close">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-brand text-white"
                      : "bg-black/[0.05] text-zinc-800 dark:bg-white/[0.08] dark:text-zinc-100"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-black/[0.05] px-3 py-2 text-sm text-zinc-500 dark:bg-white/[0.08]">Thinking…</div>
              </div>
            )}
            {error && <p className="px-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>

          <div className="border-t border-zinc-200 p-2 dark:border-white/[0.08]">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={1}
                placeholder="Ask the assistant…"
                className="input max-h-28 flex-1 resize-none py-2 text-sm"
              />
              <button onClick={send} disabled={busy || !input.trim()} className="btn-primary px-3 py-2 text-sm disabled:opacity-40" aria-label="Send">
                <FontAwesomeIcon icon={faPaperPlane} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-light text-xl text-white shadow-xl shadow-brand/40 transition-transform hover:scale-105"
        aria-label="Open assistant"
      >
        <FontAwesomeIcon icon={open ? faXmark : faRobot} />
      </button>
    </div>
  );
}
