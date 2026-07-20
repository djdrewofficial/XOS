import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { updateSetting, addAudience, removeAudience, updateTypeTemplates } from "./actions";

export const dynamic = "force-dynamic";

type NotifType = {
  key: string;
  label: string;
  category: string;
  description: string | null;
  is_client_facing: boolean;
  is_active: boolean;
  email_template_id: string | null;
  sms_template_id: string | null;
  sort_order: number;
};
type Setting = {
  id: string;
  type_key: string;
  audience: string;
  is_enabled: boolean;
  in_app: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
};
type Tpl = { id: string; name: string; is_sms: boolean };

const AUDIENCE_LABEL: Record<string, string> = {
  master_admin: "Master admins",
  admin: "Admins",
  salesperson: "All salespeople",
  employee: "All employees",
  event_salesperson: "The event's salesperson",
  event_assigned_staff: "Staff assigned to the event",
  client: "The client",
};
const ALL_AUDIENCES = Object.keys(AUDIENCE_LABEL);

const CATEGORY_LABEL: Record<string, string> = {
  events: "Events",
  money: "Money",
  staff: "Staff & Operations",
  comms: "Communications",
};
const CATEGORY_ORDER = ["events", "money", "staff", "comms"];

function Channel({ name, on }: { name: "in_app" | "push" | "email" | "sms"; on: boolean }) {
  const label = name === "in_app" ? "🔔 In-app" : name === "push" ? "📱 Push" : name === "email" ? "✉️ Email" : "💬 SMS";
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
      <input type="checkbox" name={name} defaultChecked={on} className="size-4 accent-brand-light" />
      {label}
    </label>
  );
}

function AudienceRow({ s }: { s: Setting }) {
  return (
    <form
      action={updateSetting.bind(null, s.id)}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-white/10"
    >
      <label className="flex min-w-[12rem] items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="is_enabled" defaultChecked={s.is_enabled} className="size-4 accent-brand-light" />
        <span className={s.is_enabled ? "" : "text-zinc-400 line-through"}>
          {AUDIENCE_LABEL[s.audience] ?? s.audience}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Channel name="in_app" on={s.in_app} />
        <Channel name="push" on={s.push} />
        <Channel name="email" on={s.email} />
        <Channel name="sms" on={s.sms} />
      </div>
      <div className="ml-auto flex items-center gap-3">
        <button type="submit" className="rounded-md bg-brand/10 px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/20 dark:text-brand-lighter">
          Save
        </button>
        <button
          formAction={removeAudience.bind(null, s.id)}
          className="text-xs font-semibold text-red-600 hover:underline"
          title="Remove this recipient"
        >
          Remove
        </button>
      </div>
    </form>
  );
}

function TypeCard({ type, settings, emailTemplates, smsTemplates }: { type: NotifType; settings: Setting[]; emailTemplates: Tpl[]; smsTemplates: Tpl[] }) {
  const used = new Set(settings.map((s) => s.audience));
  const available = ALL_AUDIENCES.filter((a) => !used.has(a));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{type.label}</h3>
          {type.description && <p className="text-xs text-zinc-500">{type.description}</p>}
        </div>
        {type.is_client_facing && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            Client-facing
          </span>
        )}
      </div>

      <div className="space-y-2">
        {settings.length === 0 && <p className="text-xs italic text-zinc-400">No recipients — nobody is notified.</p>}
        {settings.map((s) => (
          <AudienceRow key={s.id} s={s} />
        ))}
      </div>

      {available.length > 0 && (
        <form action={addAudience.bind(null, type.key)} className="mt-3 flex items-center gap-2">
          <select name="audience" className="input text-sm" defaultValue="">
            <option value="" disabled>
              + Add a recipient…
            </option>
            {available.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABEL[a]}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/10">
            Add
          </button>
        </form>
      )}

      {type.is_client_facing && (
        <form action={updateTypeTemplates.bind(null, type.key)} className="mt-3 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-white/15">
          <div className="mb-2 flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold">
              <input type="checkbox" name="is_active" defaultChecked={type.is_active} className="size-4 accent-brand-light" />
              Enabled
            </label>
            <span className="text-[11px] text-zinc-400">Client-facing notifications ship off so they never double-send with your automations.</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select name="email_template_id" defaultValue={type.email_template_id ?? ""} className="input text-sm">
              <option value="">— email template —</option>
              {emailTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <select name="sms_template_id" defaultValue={type.sms_template_id ?? ""} className="input text-sm">
              <option value="">— SMS template —</option>
              {smsTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="mt-2 rounded-md bg-brand/10 px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/20 dark:text-brand-lighter">
            Save templates
          </button>
        </form>
      )}
    </div>
  );
}

export default async function NotificationsSettingsPage() {
  await requireModule("settings", "view", { mode: "redirect" });
  const supabase = await createClient();
  const [{ data: typesData }, { data: settingsData }, { data: tplData }] = await Promise.all([
    supabase.from("notification_types").select("key, label, category, description, is_client_facing, is_active, email_template_id, sms_template_id, sort_order").order("sort_order"),
    supabase.from("notification_settings").select("id, type_key, audience, is_enabled, in_app, push, email, sms"),
    supabase.from("email_templates").select("id, name, is_sms").eq("is_active", true).order("name"),
  ]);
  const types = (typesData ?? []) as NotifType[];
  const settings = (settingsData ?? []) as Setting[];
  const templates = (tplData ?? []) as Tpl[];
  const emailTemplates = templates.filter((t) => !t.is_sms);
  const smsTemplates = templates.filter((t) => t.is_sms);

  const byType = new Map<string, Setting[]>();
  for (const s of settings) {
    const list = byType.get(s.type_key) ?? [];
    list.push(s);
    byType.set(s.type_key, list);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="page-title mb-1">Notifications</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Control who gets notified about what, and how. For each event, pick the recipients and the channels —
        🔔 in-app, 📱 push (staff app), ✉️ email, 💬 SMS. Push is on by default. Recipients can be roles or
        event-specific (&ldquo;the event&apos;s salesperson&rdquo;, &ldquo;staff assigned to the event&rdquo;).
      </p>

      <div className="space-y-8">
        {CATEGORY_ORDER.filter((c) => types.some((t) => t.category === c)).map((cat) => (
          <section key={cat}>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">{CATEGORY_LABEL[cat] ?? cat}</h2>
            <div className="space-y-3">
              {types
                .filter((t) => t.category === cat)
                .map((t) => (
                  <TypeCard key={t.key} type={t} settings={byType.get(t.key) ?? []} emailTemplates={emailTemplates} smsTemplates={smsTemplates} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
