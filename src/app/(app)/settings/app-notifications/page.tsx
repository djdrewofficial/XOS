import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { createTemplate, saveCompanyBookingDefaults } from "./actions";
import SaveButton from "@/components/SaveButton";

export const dynamic = "force-dynamic";

export default async function AppNotificationsSettingsPage() {
  await requireModule("settings", "view", { mode: "redirect" });
  const supabase = await createClient();

  const [{ data: templates, error: tplErr }, { data: screens }, { data: company }] = await Promise.all([
    supabase
      .from("app_notification_templates")
      .select("id, name, title, is_active, trigger_type, audience, schedule_days, schedule_direction, show_as_popup, send_push")
      .order("name"),
    supabase.from("app_notification_screens").select("id, name, is_active, embed_source").order("name"),
    supabase.from("company_settings").select("default_booking_url, default_booking_embed_html").eq("id", true).maybeSingle(),
  ]);

  if (tplErr && /does not exist|schema cache|Could not find/i.test(tplErr.message)) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-2">App Notifications</h1>
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          One-time setup needed: apply migration <code className="font-mono">00241_app_push_notifications.sql</code> to
          create the couple-app notification tables.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="page-title mb-1">App Notifications</h1>
        <p className="text-sm text-zinc-500">
          Scheduled push notifications and in-app popups for the couple app (xpress-client). Templates support merge tags
          and per-DJ booking embeds. Delivery uses Expo push and does not require push opt-in for in-app popups.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Templates</h2>
          <form action={createTemplate}>
            <input type="hidden" name="name" value="New app notification" />
            <button type="submit" className="btn-primary px-4 text-sm">
              New template
            </button>
          </form>
        </div>
        {(templates ?? []).length === 0 ? (
          <p className="text-sm text-zinc-500">No templates yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.02]">
            {(templates ?? []).map((t) => (
              <li key={t.id}>
                <Link
                  href={`/settings/app-notifications/${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-white/[0.04]"
                >
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-zinc-500">
                      {t.trigger_type}
                      {t.trigger_type === "schedule" && t.schedule_days != null
                        ? ` · ${t.schedule_days}d ${t.schedule_direction} event`
                        : ""}
                      {" · "}
                      {t.audience}
                      {t.send_push ? " · push" : ""}
                      {t.show_as_popup ? " · popup" : ""}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      t.is_active ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {t.is_active ? "Active" : "Off"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Custom screens</h2>
          <Link href="/settings/app-notifications/screens" className="text-sm font-semibold text-brand hover:underline">
            Manage screens →
          </Link>
        </div>
        <p className="text-sm text-zinc-500">
          {(screens ?? []).length} screen{(screens ?? []).length === 1 ? "" : "s"} — tap targets for notifications,
          with optional HighLevel booking embeds.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Company DJ defaults</h2>
        <p className="text-sm text-zinc-500">
          Used when an event has no assigned DJ (or the DJ has no booking fields). Per-DJ values live on each employee&apos;s
          Contact tab.
        </p>
        <form action={saveCompanyBookingDefaults} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Default booking URL</span>
            <input
              name="default_booking_url"
              defaultValue={company?.default_booking_url ?? ""}
              className="input w-full"
              placeholder="https://…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Default booking embed HTML</span>
            <textarea
              name="default_booking_embed_html"
              defaultValue={company?.default_booking_embed_html ?? ""}
              rows={5}
              className="input w-full font-mono text-xs"
              placeholder="<iframe …> or HighLevel widget script"
            />
          </label>
          <p className="text-xs text-zinc-500">
            Staff-authored only. Served to the couple app in a sandboxed WebView — never rendered raw in XOS web pages.
          </p>
          <SaveButton className="btn-primary px-6">Save defaults</SaveButton>
        </form>
      </section>
    </div>
  );
}
