import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { Section, Note } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import { createArticle, updateArticle, toggleArticle, deleteArticle } from "./actions";
import { ASSISTANT_MODEL, isOpenAIConfigured } from "@/lib/openai";

export const dynamic = "force-dynamic";

type Article = {
  id: string;
  title: string;
  category: string | null;
  content: string;
  is_active: boolean;
  updated_at: string;
};

export default async function AssistantSettingsPage() {
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff" || me.role !== "master_admin") redirect("/");

  const { data: articles, error } = await supabase
    .from("kb_articles")
    .select("id, title, category, content, is_active, updated_at")
    .order("sort_order")
    .order("title");

  if (error) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">AI Assistant</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00070_kb_articles.sql</code>{" "}
            in the Supabase SQL editor, then refresh.
          </p>
        </div>
      </div>
    );
  }

  const list = (articles ?? []) as Article[];

  return (
    <div className="max-w-4xl">
      <h1 className="page-title mb-2">AI Assistant</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Build the knowledge base your assistant answers from. Each article is fed to the chat bubble as context — add
        FAQs, how-tos, policies, and &quot;how we do X.&quot; The assistant is currently <strong>Master Admin only</strong> while
        you train it.
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-black/[0.02] px-4 py-3 text-sm dark:border-white/[0.07] dark:bg-white/[0.03]">
        <span className={`inline-block size-2 rounded-full ${isOpenAIConfigured() ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-zinc-600 dark:text-zinc-400">
          {isOpenAIConfigured() ? "OpenAI connected" : "OpenAI key missing — set OPENAI_API_KEY"} · model{" "}
          <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">{ASSISTANT_MODEL}</code>
        </span>
      </div>

      {/* Add new */}
      <Section title="Add Knowledge">
        <form action={createArticle} className="space-y-3 p-4">
          <div className="flex flex-wrap gap-3">
            <input name="title" required placeholder="Title (e.g. How to add a payment)" className="input min-w-64 flex-1" />
            <input name="category" placeholder="Category (optional)" className="input w-52" />
          </div>
          <textarea name="content" rows={4} placeholder="What should the assistant know? Write it like you'd explain it to a new hire." className="input w-full" />
          <div className="flex justify-end">
            <SaveButton savedLabel="Added">Add Article</SaveButton>
          </div>
        </form>
      </Section>

      {/* Existing */}
      <Section title={`Knowledge Base (${list.length})`}>
        {list.length === 0 ? (
          <Note>No articles yet. Add your first one above — the assistant will start using it immediately.</Note>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {list.map((a) => (
              <details key={a.id} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-2">
                  <span className={`inline-block size-2 shrink-0 rounded-full ${a.is_active ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
                  <span className="font-semibold text-zinc-800 dark:text-zinc-100">{a.title}</span>
                  {a.category && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand dark:bg-brand/30 dark:text-brand-lighter">{a.category}</span>}
                  {!a.is_active && <span className="text-[10px] font-bold uppercase text-zinc-400">inactive</span>}
                  <span className="ml-auto text-xs text-zinc-400 group-open:hidden">edit ▾</span>
                </summary>
                <form action={updateArticle.bind(null, a.id)} className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-3">
                    <input name="title" defaultValue={a.title} required className="input min-w-64 flex-1" />
                    <input name="category" defaultValue={a.category ?? ""} placeholder="Category" className="input w-52" />
                  </div>
                  <textarea name="content" rows={5} defaultValue={a.content} className="input w-full" />
                  <div className="flex items-center justify-between">
                    <div className="flex gap-3">
                      <button formAction={toggleArticle.bind(null, a.id, !a.is_active)} className="text-xs font-semibold text-brand hover:underline dark:text-brand-lighter">
                        {a.is_active ? "Deactivate" : "Reactivate"}
                      </button>
                      <button formAction={deleteArticle.bind(null, a.id)} className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400">
                        Delete
                      </button>
                    </div>
                    <SaveButton>Save</SaveButton>
                  </div>
                </form>
              </details>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
