"use client";

import { useState } from "react";
import RichTextEditor from "@/components/RichTextEditor";
import SaveButton from "@/components/SaveButton";
import { BLOCK_NAMES, SMART_BLOCKS, type DocBlock } from "@/lib/documentBlocks";

/* Block-based document builder. Text blocks open the rich-text editor (merge
   tags included); smart blocks are placeholders rendered from event data at
   generation time. Used for templates (raw) and one-off edits of generated
   documents (mode="document": smart blocks are frozen html, shown read-only). */
export default function DocumentBuilder({
  initial,
  mode,
}: {
  initial: DocBlock[];
  mode: "template" | "document";
}) {
  const [blocks, setBlocks] = useState<DocBlock[]>(initial);

  function move(index: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const next = [...prev];
      const t = index + dir;
      if (t < 0 || t >= next.length) return prev;
      [next[index], next[t]] = [next[t], next[index]];
      return next;
    });
  }

  function remove(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }

  function add(type: DocBlock["type"]) {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type, html: type === "text" ? "" : undefined }]);
  }

  return (
    <div className="space-y-3">
      {/* block order/type manifest — html for text blocks travels via the editors' own hidden inputs */}
      <input
        type="hidden"
        name="block_manifest"
        value={JSON.stringify(blocks.map((b) => ({ id: b.id, type: b.type })))}
      />

      {blocks.map((b, i) => (
        <div key={b.id} className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-zinc-100 bg-black/[0.02] px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.03]">
            <span className="rounded bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand dark:bg-brand-light/15 dark:text-brand-lighter">
              {BLOCK_NAMES[b.type]}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30">↓</button>
              <button type="button" onClick={() => remove(i)} className="ml-1 text-xs font-semibold text-red-600 hover:underline dark:text-red-400">Remove</button>
            </span>
          </div>

          {b.type === "text" ? (
            <div className="p-3">
              <RichTextEditor name={`block_html_${b.id}`} defaultValue={b.html ?? ""} />
            </div>
          ) : mode === "document" && b.html ? (
            <div className="p-4">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-400">
                Frozen at generation — re-generate the document to refresh
              </div>
              <div className="pointer-events-none rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700 dark:border-white/10 [&_table]:w-full" dangerouslySetInnerHTML={{ __html: b.html }} />
            </div>
          ) : (
            <p className="px-4 py-5 text-sm text-zinc-500">
              {SMART_BLOCKS.find((s) => s.type === b.type)?.description ?? "Rendered from the event when a document is generated."}
            </p>
          )}
        </div>
      ))}

      {blocks.length === 0 && (
        <p className="card px-4 py-10 text-center text-sm text-zinc-500">Empty document — add blocks below.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Add block:</span>
          <button type="button" onClick={() => add("text")} className="btn-ghost px-3 py-1.5 text-xs">+ Text</button>
          {SMART_BLOCKS.map((s) => (
            <button key={s.type} type="button" onClick={() => add(s.type)} title={s.description} className="btn-ghost px-3 py-1.5 text-xs">
              + {s.name}
            </button>
          ))}
        </div>
        <SaveButton>Save Document</SaveButton>
      </div>
    </div>
  );
}
