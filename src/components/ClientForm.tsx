import type { Client } from "@/lib/types";
import SaveButton from "@/components/SaveButton";

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
        <div>
          <label className={label}>Instagram</label>
          <input name="instagram" defaultValue={client?.instagram ?? ""} placeholder="@handle" className={input} />
        </div>
        <div>
          <label className={label}>TikTok</label>
          <input name="tiktok" defaultValue={client?.tiktok ?? ""} placeholder="@handle" className={input} />
        </div>
      </div>
      <div className="border-t border-zinc-200 pt-4 dark:border-white/10">
        <p className="label-xs mb-1">Authorized Representative <span className="font-normal text-zinc-400">(corporate agreements)</span></p>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">The person authorized to sign and bind the company on contracts.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={label}>Representative Name</label>
            <input name="authorized_rep_name" defaultValue={client?.authorized_rep_name ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Title / Role</label>
            <input name="authorized_rep_title" defaultValue={client?.authorized_rep_title ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Representative Email</label>
            <input type="email" name="authorized_rep_email" defaultValue={client?.authorized_rep_email ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Representative Phone</label>
            <input name="authorized_rep_phone" defaultValue={client?.authorized_rep_phone ?? ""} className={input} />
          </div>
        </div>
      </div>
      <div>
        <label className={label}>Notes</label>
        <textarea name="notes" rows={3} defaultValue={client?.notes ?? ""} className={input} />
      </div>
      <SaveButton>
        Save Client
      </SaveButton>
    </form>
  );
}
