"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number {
  const n = parseFloat((v ?? "0").toString());
  return Number.isFinite(n) ? n : 0;
}

export async function createVenue(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("venues").insert({
    name: clean(formData.get("name")) ?? "",
    address: clean(formData.get("address")),
    city: clean(formData.get("city")),
    state: clean(formData.get("state")),
    travel_fee: num(formData.get("travel_fee")),
    setup_fee: num(formData.get("setup_fee")),
    load_in_details: clean(formData.get("load_in_details")),
    notes: clean(formData.get("notes")),
    is_one_time: formData.get("is_one_time") === "on",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/venues");
}
