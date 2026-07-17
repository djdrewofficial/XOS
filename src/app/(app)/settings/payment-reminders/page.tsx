import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { createReminderRule, updateReminderRule, deleteReminderRule, runRemindersNow } from "./actions";

export const dynamic = "force-dynamic";

type Rule = {
  id: string;
  label: string;
  offset_days: number;
  send_email: boolean;
  email_template_id: string | null;
  send_sms: boolean;
  sms_template_id: string | null;
  is_active: boolean;
};
type Tpl = { id: string; name: string; is_sms: boolean };

function whenOf(offset: number): "before" | "on" | "after" {
  return offset < 0 ? "before" : offset > 0 ? "after" : "on";
}

function TemplateSelect({ name, value, templates, placeholder }: { name: string; value: string | null; templates: Tpl[]; placeholder: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} className="input w-full">
      <option value="">{placeholder}</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}

function RuleForm({
  rule,
  emailTemplates,
  smsTemplates,
}: {
  rule: Rule | null;
  emailTemplates: Tpl[];
  smsTemplates: Tpl[];
}) {
  const when = rule ? whenOf(rule.offset_days) : "before";
  const mag = rule ? Math.abs(rule.offset_days) : 3;
  const action = rule ? updateReminderRule.bind(null, rule.id) : createReminderRule;

  return (
    <form action={action} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Days</span>
          <input name="offset_magnitude" type="number" min={0} defaultValue={mag} className="input w-20" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">When</span>
          <select name="offset_when" defaultValue={when} className="input">
            <option value="before">before due</option>
            <option value="on">on the due date</option>
            <option value="after">after due (late)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={rule?.is_active ?? false} className="size-4 accent-brand-light" />
          <span className="text-zinc-600 dark:text-zinc-300">Active</span>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="send_email" defaultChecked={rule?.send_email ?? true} className="size-4 accent-brand-light" />
            Email
          </label>
          <TemplateSelect name="email_template_id" value={rule?.email_template_id ?? null} templates={emailTemplates} placeholder="— choose email template —" />
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="send_sms" defaultChecked={rule?.send_sms ?? false} className="size-4 accent-brand-light" />
            SMS
          </label>
          <TemplateSelect name="sms_template_id" value={rule?.sms_template_id ?? null} templates={smsTemplates} placeholder="— choose SMS template —" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button type="submit" className="btn-primary px-6">{rule ? "Save" : "Add reminder"}</button>
        {rule && (
          <button formAction={deleteReminderRule.bind(null, rule.id)} className="text-sm font-semibold text-red-600 hover:underline">
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

export default async function PaymentRemindersPage() {
  await requireModule("settings", "view", { mode: "redirect" });
  const supabase = await createClient();
  const [{ data: rulesData }, { data: tplData }] = await Promise.all([
    supabase
      .from("payment_reminder_rules")
      .select("id, label, offset_days, send_email, email_template_id, send_sms, sms_template_id, is_active")
      .order("offset_days"),
    supabase.from("email_templates").select("id, name, is_sms").eq("is_active", true).order("name"),
  ]);
  const rules = (rulesData ?? []) as Rule[];
  const templates = (tplData ?? []) as Tpl[];
  const emailTemplates = templates.filter((t) => !t.is_sms);
  const smsTemplates = templates.filter((t) => t.is_sms);
  const anyActive = rules.some((r) => r.is_active);

  return (
    <div className="max-w-3xl">
      <h1 className="page-title mb-1">Payment Reminders</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Automatic reminders tied to each payment&apos;s due date. They stop on their own once an installment is paid, and
        each reminder is sent at most once per payment. Runs daily.
      </p>

      {!anyActive && (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          These reminders are <strong>off</strong>. Review the copy in Settings → Email &amp; SMS Templates (group
          &ldquo;PAYMENT REMINDERS&rdquo;), then check <strong>Active</strong> on each rule you want live. Turn off any
          overlapping scheduled-email reminders so clients aren&apos;t double-messaged.
        </div>
      )}

      <div className="space-y-3">
        {rules.map((r) => (
          <RuleForm key={r.id} rule={r} emailTemplates={emailTemplates} smsTemplates={smsTemplates} />
        ))}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">Add a reminder</p>
        <RuleForm rule={null} emailTemplates={emailTemplates} smsTemplates={smsTemplates} />
      </div>

      <form action={runRemindersNow} className="mt-8 border-t border-zinc-200 pt-4 dark:border-white/10">
        <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/10">
          Run reminders now
        </button>
        <span className="ml-3 text-xs text-zinc-400">Sends any reminders due today for active rules. Nothing happens while all rules are off.</span>
      </form>
    </div>
  );
}
