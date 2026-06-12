"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { TextAlign } from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extension-placeholder";
import { useState } from "react";

export const MERGE_TAGS: { group: string; tags: string[] }[] = [
  { group: "Client", tags: ["<first_name>", "<last_name>", "<client_name>", "<client_email>", "<client_cell>"] },
  { group: "Event", tags: ["<event_name>", "<event_type>", "<event_date_long>", "<event_date_short>", "<event_date_countdown>", "<venue_name>", "<package_name>", "<start_time>", "<end_time>"] },
  { group: "Money", tags: ["<total_fee>", "<balance_due>", "<payments_received>", "<deposit_value>", "<overtime_rate>"] },
  { group: "Company", tags: ["<company_name>", "<company_email_signature>", "<current_date>"] },
  { group: "Documents", tags: ["<quote_summary>", "<payment_plan>", "<document_sign_link>"] },
];

const TB_BTN =
  "flex h-8 min-w-8 items-center justify-center rounded px-2 text-sm text-zinc-600 hover:bg-black/[0.06] dark:text-zinc-300 dark:hover:bg-white/10";
const TB_ON = "bg-brand/15 text-brand dark:text-brand-lighter";

export default function RichTextEditor({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue?: string;
}) {
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
        <select
          onChange={(e) => {
            if (e.target.value) insertTag(e.target.value);
            e.target.value = "";
          }}
          defaultValue=""
          className="h-8 rounded border border-zinc-300 bg-white px-2 text-xs text-zinc-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200"
          title="Insert a merge tag"
        >
          <option value="">+ Merge Tag</option>
          {MERGE_TAGS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.tags.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </optgroup>
          ))}
        </select>
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
