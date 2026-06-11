"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number {
  const n = parseFloat((v ?? "0").toString());
  return Number.isFinite(n) ? n : 0;
}

export async function createVenueCategory(formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("venue_categories").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath("/venues");
}

export async function toggleVenueCategory(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("venue_categories").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/venues");
}

export async function updateVenue(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("venues")
    .update({
      name: clean(formData.get("name")) ?? "",
      address: clean(formData.get("address")),
      city: clean(formData.get("city")),
      state: clean(formData.get("state")),
      category_id: clean(formData.get("category_id")),
      travel_fee: num(formData.get("travel_fee")),
      setup_fee: num(formData.get("setup_fee")),
      distance_miles: formData.get("distance_miles") ? num(formData.get("distance_miles")) : null,
      load_in_details: clean(formData.get("load_in_details")),
      driving_notes: clean(formData.get("driving_notes")),
      notes: clean(formData.get("notes")),
      is_one_time: formData.get("is_one_time") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/venues/${id}`);
  revalidatePath("/venues");
}

export async function addVenueContact(venueId: string, formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase.from("venue_contacts").delete().eq("id", contactId);
  if (error) throw new Error(error.message);
  revalidatePath(`/venues/${venueId}`);
}

export async function addVenueRoom(venueId: string, formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("venue_rooms").insert({ venue_id: venueId, name });
  if (error) throw new Error(error.message);
  revalidatePath(`/venues/${venueId}`);
}

export async function createVenue(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .insert({
      name: clean(formData.get("name")) ?? "",
      address: clean(formData.get("address")),
      city: clean(formData.get("city")),
      state: clean(formData.get("state")),
      category_id: clean(formData.get("category_id")),
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
