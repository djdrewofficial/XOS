import type { Client } from "@/lib/types";

export default function ClientForm({
  client,
  action,
}: {
  client?: Partial<Client>;
  action: (formData: FormData) => Promise<void>;
}) {
  const input =
    "input w-full";
  const label = "label-xs";

  return (
    <form action={action} className="space-y-4 card p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={label}>First Name</label>
          <input name="first_name" required defaultValue={client?.first_name ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Last Name</label>
          <input name="last_name" defaultValue={client?.last_name ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Organization</label>
          <input name="organization" defaultValue={client?.organization ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Cell Phone</label>
          <input name="cell_phone" defaultValue={client?.cell_phone ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Email</label>
          <input type="email" name="email" defaultValue={client?.email ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Mailing Address</label>
          <input name="mailing_address" defaultValue={client?.mailing_address ?? ""} className={input} />
        </div>
      </div>
      <div>
        <label className={label}>Notes</label>
        <textarea name="notes" rows={3} defaultValue={client?.notes ?? ""} className={input} />
      </div>
      <button className="btn-primary">
        Save Client
      </button>
    </form>
  );
}
