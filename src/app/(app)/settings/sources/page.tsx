import { createClient } from "@/lib/supabase/server";
import SaveButton from "@/components/SaveButton";
import EntityPicker from "@/components/EntityPicker";
import { createSource, updateSource } from "./actions";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const supabase = await createClient();
  const [{ data: sources }, { data: venues }, { data: vendors }, { data: events }] = await Promise.all([
    supabase.from("inquiry_sources").select("*").order("name"),
    supabase.from("venues").select("id, name").order("name"),
    supabase.from("vendors").select("id, company_name").order("company_name"),
    supabase.from("events").select("inquiry_source_id"),
  ]);

  const usage = new Map<string, number>();
  (events ?? []).forEach((e) => {
    if (e.inquiry_source_id) usage.set(e.inquiry_source_id, (usage.get(e.inquiry_source_id) ?? 0) + 1);
  });

  // labels for already-linked venue/vendor pickers (avoids a fetch per row)
  const venueName = new Map((venues ?? []).map((v) => [v.id, v.name]));
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.company_name]));

  return (
    <div className="max-w-4xl">
      <h1 className="page-title mb-1">Inquiry Sources</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Where leads come from. Link a source to a venue or vendor to attribute referrals —
        this powers the inquiry-source reports (leads and revenue by referrer).
      </p>

      <div className="card mb-6 overflow-hidden">
        <div className="table-head flex items-center py-2">
          <span className="w-[26%] px-3">Source Name</span>
          <span className="w-[24%] px-2">Linked Venue</span>
          <span className="w-[24%] px-2">Linked Vendor</span>
          <span className="w-[8%] text-center">Active</span>
          <span className="w-[8%] text-center">Leads</span>
          <span className="w-[10%] px-3 text-right">Save</span>
        </div>
        {(sources ?? []).map((s) => (
          <form
            key={s.id}
            action={updateSource.bind(null, s.id)}
            className={`row flex w-full items-center py-1.5 ${!s.is_active ? "opacity-50" : ""}`}
          >
            <span className="w-[26%] px-3">
              <input name="name" defaultValue={s.name} className="input w-full py-1.5" />
            </span>
            <span className="w-[24%] px-2">
              <EntityPicker kind="venue" name="venue_id" compact defaultValue={s.venue_id ?? ""} defaultLabel={s.venue_id ? venueName.get(s.venue_id) : undefined} />
            </span>
            <span className="w-[24%] px-2">
              <EntityPicker kind="vendor" name="vendor_id" compact defaultValue={s.vendor_id ?? ""} defaultLabel={s.vendor_id ? vendorName.get(s.vendor_id) : undefined} />
            </span>
            <span className="w-[8%] text-center">
              <input type="checkbox" name="is_active" defaultChecked={s.is_active} className="size-4 accent-brand-light" />
            </span>
            <span className="w-[8%] text-center text-xs text-zinc-500">{usage.get(s.id) ?? 0}</span>
            <span className="flex w-[10%] justify-end px-3">
              <button className="btn-ghost px-3 py-1 text-xs">Save</button>
            </span>
          </form>
        ))}
      </div>

      <h2 className="card-title">Add Inquiry Source</h2>
      <form action={createSource} className="card flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-44 flex-1">
          <label className="label-xs">Name</label>
          <input name="name" required className="input w-full" placeholder="e.g. The Breakers Palm Beach" />
        </div>
        <div className="min-w-44">
          <label className="label-xs">Linked Venue (optional)</label>
          <EntityPicker kind="venue" name="venue_id" />
        </div>
        <div className="min-w-44">
          <label className="label-xs">Linked Vendor (optional)</label>
          <EntityPicker kind="vendor" name="vendor_id" />
        </div>
        <SaveButton savedLabel="Added">Add Source</SaveButton>
      </form>
    </div>
  );
}
