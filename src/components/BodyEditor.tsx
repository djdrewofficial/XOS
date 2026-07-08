"use client";

import { useState } from "react";
import RichTextEditor, { type SocialLinks } from "@/components/RichTextEditor";

/* Email body field with two modes:
   - Rich text (default): the tiptap editor, for hand-written emails.
   - HTML code: a raw <textarea> that preserves the exact markup — needed for
     full HTML emails exported from BeeFree/Mailchimp etc., which the rich editor
     would strip of images, tables, buttons, and social icons.
   Submits body_html (from whichever mode is active) plus is_raw_html so the
   editor reopens in the same mode. The send pipeline already passes complete
   HTML documents through untouched. */
export default function BodyEditor({
  name,
  defaultValue,
  defaultRaw,
  tagGroups,
  socialLinks,
}: {
  name: string;
  defaultValue?: string;
  defaultRaw?: boolean;
  tagGroups?: { group: string; tags: string[] }[];
  socialLinks?: SocialLinks;
}) {
  const [raw, setRaw] = useState(!!defaultRaw);
  const [body, setBody] = useState(defaultValue ?? "");

  return (
    <div>
      <input type="hidden" name="is_raw_html" value={raw ? "on" : ""} />

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-white/15">
          <button
            type="button"
            onClick={() => setRaw(false)}
            className={`px-3 py-1 text-xs transition ${!raw ? "bg-brand text-white" : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/10"}`}
          >
            Rich text
          </button>
          <button
            type="button"
            onClick={() => setRaw(true)}
            className={`px-3 py-1 text-xs transition ${raw ? "bg-brand text-white" : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/10"}`}
          >
            HTML code
          </button>
        </div>
        {raw && (
          <span className="text-[11px] text-zinc-500">
            Paste full HTML (BeeFree, Mailchimp…). Sent exactly as-is; the branded wrapper is skipped for complete documents.
          </span>
        )}
      </div>

      {raw ? (
        <textarea
          name={name}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={20}
          spellCheck={false}
          placeholder="Paste your exported email HTML here…"
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-zinc-800 focus:outline-none focus:ring-1 focus:ring-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200"
        />
      ) : (
        <RichTextEditor name={name} defaultValue={body} tagGroups={tagGroups} onChange={setBody} socialLinks={socialLinks} />
      )}

      {raw && (
        <p className="mt-1.5 text-[11px] text-zinc-400">
          Switching back to Rich text will strip images, tables, and buttons — keep imported emails in HTML code mode.
        </p>
      )}
    </div>
  );
}
