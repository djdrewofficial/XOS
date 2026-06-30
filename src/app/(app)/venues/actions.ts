"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number {
  const n = parseFloat((v ?? "0").toString());
  return Number.isFinite(n) ? n : 0;
}

/* ---------------- Bulk actions (Venues directory) ---------------- */

/** Archive (or restore) venues — hides them from the directory without deleting. */
export async function archiveVenues(ids: string[], archive: boolean): Promise<void> {
  if (!ids.length) return;
  const supabase = await createClient();
  await requireModule("venues", "edit", { mode: "throw", supabase });
  const { error } = await supabase
    .from("venues")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/venues");
}

/** Permanently delete venues. Venues still attached to events can't be deleted
    (that would orphan the events) — those are skipped and reported back. */
export async function deleteVenues(
  ids: string[],
): Promise<{ deleted: number; skipped: { id: string; name: string; events: number }[] }> {
  const skipped: { id: string; name: string; events: number }[] = [];
  if (!ids.length) return { deleted: 0, skipped };
  const supabase = await createClient();
  await requireModule("venues", "edit", { mode: "throw", supabase });

  const { data: evRows } = await supabase.from("events").select("venue_id").in("venue_id", ids);
  const counts: Record<string, number> = {};
  (evRows ?? []).forEach((e) => {
    if (e.venue_id) counts[e.venue_id] = (counts[e.venue_id] ?? 0) + 1;
  });
  const blocked = new Set(Object.keys(counts));
  const deletable = ids.filter((id) => !blocked.has(id));

  if (blocked.size) {
  await requireModule("venues", "edit", { mode: "throw" });
    const { data: vs } = await supabase.from("venues").select("id, name").in("id", [...blocked]);
    (vs ?? []).forEach((v) => skipped.push({ id: v.id, name: v.name, events: counts[v.id] ?? 0 }));
  }

  if (deletable.length) {
    // inquiry_sources.venue_id is NO ACTION — detach before deleting; contacts /
    // rooms / djep_map cascade away with the venue.
    await supabase.from("inquiry_sources").update({ venue_id: null }).in("venue_id", deletable);
    const { error } = await supabase.from("venues").delete().in("id", deletable);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/venues");
  return { deleted: deletable.length, skipped };
}

const MERGE_FIELDS = new Set([
  "name", "address", "city", "state", "zip", "category_id", "travel_fee", "setup_fee",
  "distance_miles", "driving_notes", "load_in_details", "notes", "is_one_time", "auto_mileage",
  "contact_name", "phone", "email", "website",
]);

/** Merge loser venues into a survivor: reassign every reference (events,
    inquiry_sources, contacts, rooms) onto the survivor, repoint the legacy DJEP
    map so the survivor "owns" the losers' DJEP ids too (events never
    dis-associate), apply the chosen field values, then delete the losers. */
export async function mergeVenues(
  survivorId: string,
  loserIds: string[],
  fields: Record<string, unknown>,
): Promise<void> {
  const losers = [...new Set(loserIds)].filter((id) => id && id !== survivorId);
  if (!losers.length) return;
  const supabase = await createClient();
  await requireModule("venues", "edit", { mode: "throw", supabase });

  // 1) reassign all references loser -> survivor (this includes venue_djep_map,
  //    which is how the survivor inherits the losers' DJEP ids).
  for (const table of ["events", "inquiry_sources", "venue_contacts", "venue_rooms", "venue_djep_map"]) {
  await requireModule("venues", "edit", { mode: "throw" });
    const { error } = await supabase.from(table).update({ venue_id: survivorId }).in("venue_id", losers);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  // 2) apply the chosen "keep" values to the survivor (whitelisted columns only)
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) if (MERGE_FIELDS.has(k)) patch[k] = v;
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("venues").update(patch).eq("id", survivorId);
    if (error) throw new Error(error.message);
  }

  // 3) delete the now-detached losers
  const { error: delErr } = await supabase.from("venues").delete().in("id", losers);
  if (delErr) throw new Error(delErr.message);

  revalidatePath("/venues");
  revalidatePath(`/venues/${survivorId}`);
}

export async function createVenueCategory(formData: FormData) {
  await requireModule("venues", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("venue_categories").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath("/venues");
}

export async function toggleVenueCategory(id: string, isActive: boolean) {
  await requireModule("venues", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("venue_categories").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/venues");
}

export async function updateVenue(id: string, formData: FormData) {
  await requireModule("venues", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("venues")
    .update({
      name: clean(formData.get("name")) ?? "",
      address: clean(formData.get("address")),
      city: clean(formData.get("city")),
      state: clean(formData.get("state")),
      category_id: clean(formData.get("category_id")),
      contact_name: clean(formData.get("contact_name")),
      phone: clean(formData.get("phone")),
      email: clean(formData.get("email")),
      website: clean(formData.get("website")),
      travel_fee: num(formData.get("travel_fee")),
      setup_fee: num(formData.get("setup_fee")),
      distance_miles: formData.get("distance_miles") ? num(formData.get("distance_miles")) : null,
      travel_minutes: formData.get("travel_minutes") ? num(formData.get("travel_minutes")) : null,
      load_in_details: clean(formData.get("load_in_details")),
      driving_notes: clean(formData.get("driving_notes")),
      notes: clean(formData.get("notes")),
      is_one_time: formData.get("is_one_time") === "on",
      auto_mileage: formData.get("auto_mileage") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/venues/${id}`);
  revalidatePath("/venues");
  revalidatePath("/settings/expenses");
}

export async function addVenueContact(venueId: string, formData: FormData) {
  await requireModule("venues", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("venue_contacts").insert({
    venue_id: venueId,
    name,
    role: clean(formData.get("role")),
    phone: clean(formData.get("phone")),
    email: clean(formData.get("email")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/venues/${venueId}`);
}

export async function removeVenueContact(venueId: string, contactId: string) {
  await requireModule("venues", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("venue_contacts").delete().eq("id", contactId);
  if (error) throw new Error(error.message);
  revalidatePath(`/venues/${venueId}`);
}

export async function addVenueRoom(venueId: string, formData: FormData) {
  await requireModule("venues", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("venue_rooms").insert({ venue_id: venueId, name });
  if (error) throw new Error(error.message);
  revalidatePath(`/venues/${venueId}`);
}

export async function createVenue(formData: FormData) {
  await requireModule("venues", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .insert({
      name: clean(formData.get("name")) ?? "",
      address: clean(formData.get("address")),
      city: clean(formData.get("city")),
      state: clean(formData.get("state")),
      category_id: clean(formData.get("category_id")),
      contact_name: clean(formData.get("contact_name")),
      phone: clean(formData.get("phone")),
      email: clean(formData.get("email")),
      website: clean(formData.get("website")),
      travel_fee: num(formData.get("travel_fee")),
      setup_fee: num(formData.get("setup_fee")),
      load_in_details: clean(formData.get("load_in_details")),
      notes: clean(formData.get("notes")),
      is_one_time: formData.get("is_one_time") === "on",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/venues");
  redirect(`/venues/${data.id}`);
}
