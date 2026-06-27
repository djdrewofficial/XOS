import { createClient } from "@/lib/supabase/server";
import SaveButton from "@/components/SaveButton";
import CopyButton from "@/components/CopyButton";
import MergeTagWizard from "@/components/MergeTagWizard";
import { addCustomTag, updateCustomTag, deleteCustomTag } from "./actions";

export const dynamic = "force-dynamic";

type Tag = {
  id: string;
  tag_key: string;
  label: string;
  group_name: string;
  description: string | null;
  is_builtin: boolean;
  source_type: string;
  source_value: string | null;
  is_active: boolean;
};

const SOURCE_TYPES: [string, string][] = [
  ["static", "Static text / link"],
  ["poc_field", "Point of Contact field"],
  ["client_field", "Client field"],
  ["event_field", "Event field"],
  ["company_field", "Company setting"],
];

export default async function MergeTagsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("merge_tags")
    .select("*")
    .order("is_builtin", { ascending: false })
    .order("group_name")
    .order("label");
  const tags = (data ?? []) as Tag[];
  const groups = [...new Set(tags.map((t) => t.group_name))];
  const customCount = tags.filter((t) => !t.is_builtin).length;

  return (
    <div className="max-w-[1100px]">
      <h1 className="mb-1 text-2xl font-bold">Merge Tags</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Merge tags like <code className="rounded bg-black/5 px-1 dark:bg-white/10">&lt;first_name&gt;</code> are replaced with real
        client/event data when an email sends. Built-in tags are managed by the system; you can add and manage your own custom tags below.
      </p>

      <div className="mb-6">
        <MergeTagWizard addTag={addCustomTag} />
      </div>

      <details className="card mb-6 p-4">
        <summary className="cursor-pointer text-sm font-semibold">+ Add a custom tag manually</summary>
        <form action={addCustomTag} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label-xs">Tag Key</label>
            <input name="tag_key" required placeholder="poc_booking_link" className="input w-full font-mono" />
          </div>
          <div>
            <label className="label-xs">Label</label>
            <input name="label" placeholder="POC Booking Link" className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Group</label>
            <input name="group_name" defaultValue="CUSTOM" className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Source Type</label>
            <select name="source_type" defaultValue="static" className="input w-full">
              {SOURCE_TYPES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label-xs">Source Value <span className="text-zinc-400">(field name, or the static text/link)</span></label>
            <input name="source_value" className="input w-full" />
          </div>
          <div className="sm:col-span-2">
            <label className="label-xs">Description</label>
            <input name="description" className="input w-full" />
          </div>
          <div className="sm:col-span-2">
            <SaveButton className="btn-primary px-5 py-1.5 text-sm" savedLabel="Added">Add Tag</SaveButton>
          </div>
        </form>
      </details>

      <p className="mb-2 text-xs text-zinc-500">{tags.length} tags · {customCount} custom</p>

      {groups.map((g) => (
        <div key={g} className="mb-4">
          <h3 className="mb-1 rounded-t-xl bg-black/[0.07] dark:bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-900 dark:text-white">{g}</h3>
          <div className="card overflow-hidden rounded-t-none">
            <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {tags.filter((t) => t.group_name === g).map((t) =>
                t.is_builtin ? (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <code className="font-mono text-zinc-800 dark:text-zinc-200">&lt;{t.tag_key}&gt;</code>
                      <span className="ml-3 text-zinc-500">{t.label}</span>
                      {t.description && <span className="ml-2 text-xs italic text-zinc-400">{t.description}</span>}
                    </div>
                    <CopyButton text={`<${t.tag_key}>`} />
                  </li>
                ) : (
                  <li key={t.id} className="px-4 py-3">
                    <form action={updateCustomTag.bind(null, t.id)} className="grid items-end gap-2 lg:grid-cols-[1.4fr_1fr_1.1fr_1.4fr_auto]">
                      <div>
                        <label className="label-xs">Tag</label>
                        <div className="flex items-center gap-2">
                          <code className="truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">&lt;{t.tag_key}&gt;</code>
                          <CopyButton text={`<${t.tag_key}>`} />
                        </div>
                        <input type="hidden" name="is_active" value={t.is_active ? "on" : "off"} />
                      </div>
                      <div>
                        <label className="label-xs">Label</label>
                        <input name="label" defaultValue={t.label} className="input w-full" />
                      </div>
                      <div>
                        <label className="label-xs">Source Type</label>
                        <select name="source_type" defaultValue={t.source_type} className="input w-full">
                          {SOURCE_TYPES.map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label-xs">Source Value</label>
                        <input name="source_value" defaultValue={t.source_value ?? ""} className="input w-full" />
                      </div>
                      <div className="flex gap-2">
                        <SaveButton className="btn-primary px-4 py-1.5 text-xs">Save</SaveButton>
                      </div>
                      <input type="hidden" name="group_name" value={t.group_name} />
                      <input type="hidden" name="description" value={t.description ?? ""} />
                    </form>
                    <form action={deleteCustomTag.bind(null, t.id)} className="mt-1">
                      <button className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">Delete</button>
                    </form>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
