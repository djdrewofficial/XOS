"use client";

import { useState } from "react";

// Reads the surrounding form's current (unsaved) values, renders them through
// the same branded shell a real send uses, and shows the result in an iframe.
export default function EmailPreviewButton({ isSms = false }: { isSms?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState("");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState("");

  async function openPreview(e: React.MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.closest("form");
    if (!form) return;
    const fd = new FormData(form);
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/email-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body_html: String(fd.get("body_html") ?? ""),
          subject: String(fd.get("subject") ?? ""),
          branded: fd.get("branded_shell") === "on",
          sms: isSms,
        }),
      });
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      const data = await res.json();
      setHtml(data.html ?? "");
      setSubject(data.subject ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openPreview} className="btn-ghost px-5">
        Preview
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                  Preview{isSms ? " · SMS" : ""}
                </p>
                {!isSms && (
                  <p className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {subject || <span className="italic text-zinc-400">(no subject)</span>}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost text-sm">
                Close
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-zinc-100 dark:bg-black/40">
              {loading ? (
                <p className="p-10 text-center text-sm text-zinc-500">Rendering preview…</p>
              ) : error ? (
                <p className="p-10 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
              ) : (
                <iframe
                  title="Email preview"
                  srcDoc={html}
                  sandbox=""
                  className="h-[68vh] w-full border-0 bg-white"
                />
              )}
            </div>

            <div className="border-t border-zinc-200 px-4 py-2 text-center text-[11px] text-zinc-500 dark:border-white/10">
              Sample values shown for merge tags — real sends use each event’s data. Unsupported tags stay as <code>&lt;tag&gt;</code>.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
