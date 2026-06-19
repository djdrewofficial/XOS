import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { Section, Note, CheckBoxField } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import { createArticle, updateArticle, toggleArticle, deleteArticle, saveAiTask, runAiTaskNow } from "./actions";
import { ASSISTANT_MODEL, isOpenAIConfigured } from "@/lib/openai";

export const dynamic = "force-dynamic";

type Article = { id: string; title: string; category: string | null; content: string; is_active: boolean; updated_at: string };
type Task = { key: string; label: string; description: string | null; enabled: boolean; config: { recipients?: string; hour?: number } | null; last_run_on: string | null };

const fmtHour = (h: number) => {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
};

export default async function AssistantSettingsPage() {
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff" || me.role !== "master_admin") redirect("/");

  const [{ data: articles, error: kbErr }, { data: taskRows, error: taskErr }] = await Promise.all([
    supabase.from("kb_articles").select("id, title, category, content, is_active, updated_at").order("sort_order").order("title"),
    supabase.from("ai_tasks").select("key, label, description, enabled, config, last_run_on").order("label"),
  ]);

  const list = (articles ?? []) as Article[];
  const tasks = (taskRows ?? []) as Task[];

  return (
    <div className="max-w-4xl">
      <h1 className="page-title mb-2">AI Assistant</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Manage your automated AI tasks and the knowledge your assistant answers from. Master-Admin only while in training.
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-black/[0.02] px-4 py-3 text-sm dark:border-white/[0.07] dark:bg-white/[0.03]">
        <span className={`inline-block size-2 rounded-full ${isOpenAIConfigured() ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-zinc-600 dark:text-zinc-400">
          {isOpenAIConfigured() ? "OpenAI connected" : "OpenAI key missing — set OPENAI_API_KEY"} · model{" "}
          <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">{ASSISTANT_MODEL}</code>
        </span>
      </div>

      {/* ───────── Daily AI Tasks ───────── */}
      <h2 className="card-title mb-1">Daily AI Tasks</h2>
      <p className="mb-3 text-sm text-zinc-500">Automations that run on a schedule. Toggle them on/off, set the time, and run one on demand.</p>

      {taskErr ? (
        <div className="card mb-8 p-5 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-1 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>Run migration <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">00086_ai_tasks.sql</code>, then refresh.</p>
        </div>
      ) : (
        <div className="mb-8 space-y-3">
          {tasks.map((t) => {
            const hour = t.config?.hour ?? 7;
            return (
              <div key={t.key} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block size-2 shrink-0 rounded-full ${t.enabled ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
                      <span className="font-semibold text-zinc-800 dark:text-zinc-100">{t.label}</span>
                    </div>
                    {t.description && <p className="mt-1 text-sm text-zinc-500">{t.description}</p>}
                    {t.last_run_on && <p className="mt-1 text-xs text-zinc-400">Last run {t.last_run_on}</p>}
                  </div>
                  <form action={runAiTaskNow.bind(null, t.key)}>
                    <button className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-white/15 dark:text-zinc-200 dark:hover:bg-white/5">
                      Run now
                    </button>
                  </form>
                </div>

                <form action={saveAiTask.bind(null, t.key)} className="mt-3 flex flex-wrap items-end gap-4 border-t border-zinc-100 pt-3 dark:border-white/[0.06]">
                  <CheckBoxField name="enabled" label="Enabled" defaultChecked={t.enabled} />
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-zinc-500">Send time</span>
                    <select name="hour" defaultValue={String(hour)} className="input text-sm">
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{fmtHour(h)}</option>
                      ))}
                    </select>
                  </label>
                  {t.key === "morning_briefing" && (
                    <label className="block flex-1">
                      <span className="mb-1 block text-[11px] font-medium text-zinc-500">Recipients (comma-separated)</span>
                      <input name="recipients" defaultValue={t.config?.recipients ?? ""} placeholder="events@xpressdjs.com" className="input w-full min-w-56 text-sm" />
                    </label>
                  )}
                  <SaveButton>Save</SaveButton>
                </form>
              </div>
            );
          })}
        </div>
      )}

      {/* ───────── Knowledge Base ───────── */}
      <h2 className="card-title mb-1">Assistant Knowledge Base</h2>
      <p className="mb-3 text-sm text-zinc-500">What the chat assistant answers from — FAQs, how-tos, policies, &quot;how we do X.&quot;</p>

      {kbErr ? (
        <div className="card p-5 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-1 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>Run migration <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">00070_kb_articles.sql</code>, then refresh.</p>
        </div>
      ) : (
        <>
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

          <Section title={`Articles (${list.length})`}>
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
        </>
      )}
    </div>
  );
}
