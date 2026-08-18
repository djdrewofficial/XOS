import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import SaveButton from "@/components/SaveButton";
import AccountNav from "./AccountNav";
import { updateMyProfile, uploadMyPhoto } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await createClient();
  const me = await getMe(supabase);

  const { data: emp } = me?.employeeId
    ? await supabase.from("employees").select("*").eq("id", me.employeeId).maybeSingle()
    : { data: null };

  const photoUrl = emp?.photo_path
    ? supabase.storage.from("staff").getPublicUrl(emp.photo_path).data.publicUrl
    : null;

  return (
    <div className="max-w-[1000px]">
      <AccountNav active="profile" />

      {!emp ? (
        <div className="card p-8 text-center text-sm text-zinc-500">
          Your login isn&apos;t linked to a staff profile yet, so there&apos;s nothing to edit here. Ask an administrator to
          link your account.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {/* Photo */}
          <div className="card h-fit p-5">
            <h2 className="card-title">Profile Photo</h2>
            <div className="mb-4 flex flex-col items-center gap-3">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt={emp.first_name} className="size-32 rounded-2xl object-cover" />
              ) : (
                <div className="flex size-32 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-light text-4xl font-black text-white">
                  {emp.first_name?.[0]}
                  {emp.last_name?.[0]}
                </div>
              )}
              <p className="text-center text-xs text-zinc-500">Shown on your profile and Meet Your DJ emails.</p>
            </div>
            <form action={uploadMyPhoto} className="space-y-2">
              <input
                type="file"
                name="photo"
                accept="image/*"
                required
                className="block w-full text-xs text-zinc-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gradient-to-r file:from-brand file:to-brand-light file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:brightness-110"
              />
              <button className="btn-ghost w-full px-4 py-1.5 text-xs">Upload new photo</button>
            </form>
          </div>

          {/* Profile fields */}
          <div className="card p-5 lg:col-span-2">
            <h2 className="card-title">My Profile</h2>
            <form action={updateMyProfile} className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-xs">First Name</label>
                <input name="first_name" defaultValue={emp.first_name ?? ""} required className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Last Name</label>
                <input name="last_name" defaultValue={emp.last_name ?? ""} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Middle Name</label>
                <input name="middle_name" defaultValue={emp.middle_name ?? ""} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Stage Name</label>
                <input name="stage_name" defaultValue={emp.stage_name ?? ""} className="input w-full" placeholder="DJ Drew" />
              </div>
              <div>
                <label className="label-xs">Phone</label>
                <input name="phone" defaultValue={emp.phone ?? ""} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Birthday</label>
                <input type="date" name="birthday" defaultValue={emp.birthday ?? ""} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Website</label>
                <input name="website" defaultValue={emp.website ?? ""} className="input w-full" placeholder="https://…" />
              </div>
              <div>
                <label className="label-xs">Booking / Calendar Link</label>
                <input
                  name="planning_meeting_url"
                  defaultValue={emp.planning_meeting_url ?? ""}
                  className="input w-full"
                  placeholder="Your Calendly / booking URL"
                />
              </div>
              <div className="col-span-2">
                <label className="label-xs">Address</label>
                <input name="address" defaultValue={emp.address ?? ""} className="input w-full" />
              </div>
              <div className="col-span-2">
                <label className="label-xs">Emergency Contact</label>
                <input
                  name="emergency_contact"
                  defaultValue={emp.emergency_contact ?? ""}
                  className="input w-full"
                  placeholder="Name · relationship · phone"
                />
              </div>
              <div className="col-span-2">
                <label className="label-xs">Bio</label>
                <textarea
                  name="bio"
                  rows={3}
                  defaultValue={emp.bio ?? ""}
                  className="input w-full"
                  placeholder="A short bio used on Meet Your DJ emails…"
                />
              </div>
              <div className="col-span-2 flex items-center justify-between">
                <p className="text-xs text-zinc-500">
                  Email: <span className="text-zinc-700 dark:text-zinc-300">{emp.email ?? "—"}</span>
                  <span className="ml-1 text-zinc-400">(managed by an admin)</span>
                </p>
                <SaveButton>Save changes</SaveButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
