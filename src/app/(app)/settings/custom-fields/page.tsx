import { createClient } from "@/lib/supabase/server";
import { Section, Row, Note } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import { createClientRole, updateClientRole } from "./actions";

export const dynamic = "force-dynamic";

type Role = { id: string; name: string; is_active: boolean; sort_order: number };

export default async function CustomFieldsPage() {
  const supabase = await createClient();
  const { data: roles, error } = await supabase
    .from("client_role_definitions")
    .select("id, name, is_active, sort_order")
    .order("sort_order")
    .order("name");

  if (error) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Custom Fields</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">00055_client_roles.sql</code> in the
            Supabase SQL editor, then refresh.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="page-title mb-1">Custom Fields</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Labels and field definitions used across XOS. Client roles below appear when attaching clients to an event.
      </p>

      <Section title="Client Roles">
        <Note>
          Roles you can assign when adding a client to an event (e.g. Contract Holder, Partner A, Partner B). Weddings
          use <span className="font-semibold">Partner A</span> + <span className="font-semibold">Partner B</span> for
          auto-naming.
        </Note>
        {(roles as Role[]).map((r) => (
          <Row key={r.id} label="">
            <form action={updateClientRole.bind(null, r.id)} className="flex flex-wrap items-center gap-2">
              <input name="name" defaultValue={r.name} className="input w-52" />
              <input
                type="number"
                name="sort_order"
                defaultValue={r.sort_order}
                className="input w-20"
                title="Sort order"
              />
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="checkbox" name="is_active" defaultChecked={r.is_active} className="size-4 accent-brand-light" />
                Active
              </label>
              <SaveButton className="btn-ghost px-3 py-1.5 text-xs">Save</SaveButton>
            </form>
          </Row>
        ))}
        <Row label="">
          <form action={createClientRole} className="flex flex-wrap items-center gap-2">
            <input name="name" placeholder="New role…" className="input w-52" required />
            <input type="number" name="sort_order" placeholder="Sort" className="input w-20" />
            <SaveButton className="btn-primary px-3 py-1.5 text-xs" savedLabel="Added">Add Role</SaveButton>
          </form>
        </Row>
      </Section>
    </div>
  );
}
