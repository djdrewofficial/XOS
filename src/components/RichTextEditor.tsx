"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { TextAlign } from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extension-placeholder";
import { useState, useRef, useEffect } from "react";

export const MERGE_TAGS: { group: string; tags: string[] }[] = [
  { group: "Client", tags: ["<first_name>", "<last_name>", "<client_name>", "<client_organization>", "<client_email>", "<client_cell>", "<client_address>", "<authorized_rep_name>", "<authorized_rep_title>", "<authorized_rep_email>", "<authorized_rep_phone>"] },
  { group: "Event", tags: ["<event_name>", "<event_type>", "<event_date_long>", "<event_date_short>", "<event_date_countdown>", "<venue_name>", "<venue_address>", "<package_name>", "<setup_time>", "<start_time>", "<end_time>", "<guest_count>", "<billing_terms>", "<decision_maker_name>", "<decision_maker_phone>", "<decision_maker_email>"] },
  { group: "Money", tags: ["<total_fee>", "<balance_due>", "<payments_received>", "<deposit_value>", "<retainer_amount>", "<retainer_due_date>", "<overtime_rate>"] },
  { group: "Company", tags: ["<company_name>", "<company_email_signature>", "<legal_venue>", "<current_date>"] },
  { group: "Documents", tags: ["<quote_summary>", "<payment_plan>", "<document_sign_link>", "<review_sign_link>", "<review_sign_button>"] },
  { group: "Payments", tags: ["<payment_button>", "<payment_link>"] },
];

const TB_BTN =
  "flex h-8 min-w-8 items-center justify-center rounded px-2 text-sm text-zinc-600 hover:bg-black/[0.06] dark:text-zinc-300 dark:hover:bg-white/10";
const TB_ON = "bg-brand/15 text-brand dark:text-brand-lighter";

export default function RichTextEditor({
  name,
  defaultValue,
  tagGroups,
}: {
  name: string;
  defaultValue?: string;
  /** Merge-tag groups for the dropdown; falls back to the built-in list. */
  tagGroups?: { group: string; tags: string[] }[];
}) {
  const mergeTagGroups = tagGroups && tagGroups.length > 0 ? tagGroups : MERGE_TAGS;
  const [html, setHtml] = useState(defaultValue ?? "");
  const [source, setSource] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Write your email… use Merge Tags to drop in client/event values." }),
    ],
    content: defaultValue ?? "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[260px] px-4 py-3 focus:outline-none dark:prose-invert prose-p:my-2",
      },
    },
    onUpdate: ({ editor }) => setHtml(editor.getHTML()),
  });

  const insertTag = (tag: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent({ type: "text", text: tag }).run();
  };

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const toggleSource = () => {
    if (source && editor) editor.commands.setContent(html || "<p></p>");
    setSource((s) => !s);
  };

  const on = (active: boolean) => `${TB_BTN} ${active ? TB_ON : ""}`;

  return (
    <div className="rounded-lg border border-zinc-300 dark:border-white/10">
      {/* hidden field the form submits */}
      <input type="hidden" name={name} value={html} />

      <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-white/10 dark:bg-white/[0.04]">
        <button type="button" onClick={toggleSource} className={on(source)} title="HTML source">
          &lt;/&gt;
        </button>
        <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-white/10" />

        {editor && !source && (
          <>
            <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={on(editor.isActive("bold"))} title="Bold"><b>B</b></button>
            <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={on(editor.isActive("italic"))} title="Italic"><i>I</i></button>
            <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={on(editor.isActive("underline"))} title="Underline"><u>U</u></button>
            <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={on(editor.isActive("strike"))} title="Strikethrough"><s>S</s></button>
            <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-white/10" />
            <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={on(editor.isActive("heading", { level: 2 }))} title="Heading">H2</button>
            <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={on(editor.isActive("heading", { level: 3 }))} title="Subheading">H3</button>
            <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={on(editor.isActive("bulletList"))} title="Bullet list">• ⃪</button>
            <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={on(editor.isActive("orderedList"))} title="Numbered list">1.</button>
            <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-white/10" />
            <button type="button" onClick={() => editor.chain().focus().setTextAlign("left").run()} className={on(editor.isActive({ textAlign: "left" }))} title="Align left">⬅</button>
            <button type="button" onClick={() => editor.chain().focus().setTextAlign("center").run()} className={on(editor.isActive({ textAlign: "center" }))} title="Center">⬌</button>
            <button type="button" onClick={() => editor.chain().focus().setTextAlign("right").run()} className={on(editor.isActive({ textAlign: "right" }))} title="Align right">➡</button>
            <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-white/10" />
            <button type="button" onClick={setLink} className={on(editor.isActive("link"))} title="Link">🔗</button>
            <label className={`${TB_BTN} cursor-pointer`} title="Text color">
              A
              <input
                type="color"
                className="ml-0.5 h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
                onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
              />
            </label>
            <button type="button" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} className={TB_BTN} title="Clear formatting">⌫</button>
            <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-white/10" />
            <button type="button" onClick={() => editor.chain().focus().undo().run()} className={TB_BTN} title="Undo">↺</button>
            <button type="button" onClick={() => editor.chain().focus().redo().run()} className={TB_BTN} title="Redo">↻</button>
          </>
        )}

        <span className="ml-auto" />
        <MergeTagPicker groups={mergeTagGroups} onPick={insertTag} />
      </div>

      {source ? (
        <textarea
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          rows={14}
          spellCheck={false}
          className="w-full resize-y bg-transparent px-4 py-3 font-mono text-xs text-zinc-800 focus:outline-none dark:text-zinc-200"
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}

/** Searchable "+ Merge Tag" dropdown: type to filter, click or Enter to insert. */
function MergeTagPicker({
  groups,
  onPick,
}: {
  groups: { group: string; tags: string[] }[];
  onPick: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus the search box as soon as the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({
      group: g.group,
      // A whole group shows when its name matches; otherwise filter tag-by-tag.
      tags: q
        ? g.tags.filter((t) => t.toLowerCase().includes(q) || g.group.toLowerCase().includes(q))
        : g.tags,
    }))
    .filter((g) => g.tags.length > 0);
  const firstMatch = filtered[0]?.tags[0];

  const pick = (tag: string) => {
    onPick(tag);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-8 rounded border border-zinc-300 bg-white px-2 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:hover:bg-white/10"
        title="Insert a merge tag"
      >
        + Merge Tag ▾
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-white/10 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 p-2 dark:border-white/10">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (firstMatch) pick(firstMatch);
                }
              }}
              placeholder="Search merge tags…"
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-brand dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-400">
                No tags match “{query}”.
              </div>
            ) : (
              filtered.map((g) => (
                <div key={g.group} className="px-1 py-0.5">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {g.group}
                  </div>
                  {g.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => pick(tag)}
                      className="block w-full rounded px-2 py-1 text-left text-xs text-brand hover:bg-brand/10 dark:text-brand-lighter"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
