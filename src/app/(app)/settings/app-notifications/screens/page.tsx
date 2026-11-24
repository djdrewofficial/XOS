import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import SaveButton from "@/components/SaveButton";
import { createScreen, deleteScreen, updateScreen } from "../actions";

export const dynamic = "force-dynamic";

export default async function AppNotificationScreensPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  await requireModule("settings", "view", { mode: "redirect" });
  const { edit } = await searchParams;
  const supabase = await createClient();
  const { data: screens, error } = await supabase
    .from("app_notification_screens")
    .select("id, name, heading, body_html, buttons, embed_source, custom_embed_html, is_active")
    .order("name");

  if (error && /does not exist|schema cache|Could not find/i.test(error.message)) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-2">Custom screens</h1>
        <p className="text-sm text-amber-800">Apply migration 00242 first.</p>
      </div>
    );
  }

  const editing = (screens ?? []).find((s) => s.id === edit) ?? null;

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/settings/app-notifications" className="text-xs font-semibold text-zinc-500 hover:underline">
            ← App Notifications
          </Link>
          <h1 className="page-title mt-1">Custom screens</h1>
          <p className="text-sm text-zinc-500">
            In-app screens opened from a notification tap or shown as a popup. Optional embed block for HighLevel
            booking widgets (per-DJ via &lt;dj_booking_embed&gt;).
          </p>
        </div>
        <form action={createScreen}>
          <input type="hidden" name="name" value="New screen" />
          <button type="submit" className="btn-primary px-4 text-sm">
            New screen
          </button>
        </form>
      </div>

      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.02]">
        {(screens ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-zinc-500">
                {s.embed_source !== "none" ? `embed: ${s.embed_source}` : "no embed"}
                {s.is_active ? "" : " · inactive"}
              </div>
            </div>
            <Link
              href={`/settings/app-notifications/screens?edit=${s.id}`}
              className="text-sm font-semibold text-brand hover:underline"
            >
              Edit
            </Link>
          </li>
        ))}
      </ul>

      {editing && (
        <form
          action={updateScreen.bind(null, editing.id)}
          className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]"
        >
          <h2 className="font-semibold">Edit: {editing.name}</h2>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Name</span>
            <input name="name" defaultValue={editing.name} className="input w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Heading</span>
            <input name="heading" defaultValue={editing.heading ?? ""} className="input w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Body (HTML, merge tags OK)</span>
            <textarea name="body_html" defaultValue={editing.body_html ?? ""} rows={6} className="input w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Buttons JSON</span>
            <textarea
              name="buttons_json"
              defaultValue={JSON.stringify(editing.buttons ?? [], null, 2)}
              rows={4}
              className="input w-full font-mono text-xs"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              {`[{ "label": "Book a meeting", "action": "url", "url": "<dj_booking_url>" }, { "label": "Close", "action": "dismiss" }]`}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Embed source</span>
            <select name="embed_source" defaultValue={editing.embed_source ?? "none"} className="input w-full">
              <option value="none">None</option>
              <option value="dj_booking_embed">Assigned DJ booking embed</option>
              <option value="custom_html">Custom HTML (this screen)</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Custom embed HTML</span>
            <textarea
              name="custom_embed_html"
              defaultValue={editing.custom_embed_html ?? ""}
              rows={5}
              className="input w-full font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={editing.is_active !== false} className="size-4 accent-brand-light" />
            Active
          </label>
          <div className="flex items-center gap-4">
            <SaveButton className="btn-primary px-6">Save screen</SaveButton>
            <button formAction={deleteScreen.bind(null, editing.id)} className="text-sm font-semibold text-red-600 hover:underline">
              Delete
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
