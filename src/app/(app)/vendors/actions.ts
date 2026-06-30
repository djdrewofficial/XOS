"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function socialCollab(v: FormDataEntryValue | null): string | null {
  const s = clean(v);
  return s === "collab" || s === "tag" || s === "none" ? s : null;
}

export async function createVendorCategory(formData: FormData) {
  await requireModule("vendors", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("vendor_categories").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath("/vendors");
}

export async function toggleVendorCategory(id: string, isActive: boolean) {
  await requireModule("vendors", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_categories").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/vendors");
}

function vendorPayload(formData: FormData) {
  return {
    company_name: clean(formData.get("company_name")) ?? "Unnamed Vendor",
    category_id: clean(formData.get("category_id")),
    is_preferred: formData.get("is_preferred") === "on",
    website: clean(formData.get("website")),
    instagram: clean(formData.get("instagram")),
    tiktok: clean(formData.get("tiktok")),
    youtube: clean(formData.get("youtube")),
    social_collab: socialCollab(formData.get("social_collab")),
    notes: clean(formData.get("notes")),
  };
}

export async function createVendor(formData: FormData) {
  await requireModule("vendors", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .insert(vendorPayload(formData))
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/vendors");
  redirect(`/vendors/${data.id}`);
}

export async function updateVendor(id: string, formData: FormData) {
  await requireModule("vendors", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("vendors").update(vendorPayload(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/vendors/${id}`);
  revalidatePath("/vendors");
}

export async function addVendorContact(vendorId: string, formData: FormData) {
  await requireModule("vendors", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("vendor_contacts").insert({
    vendor_id: vendorId,
    name,
    role: clean(formData.get("role")),
    phone: clean(formData.get("phone")),
    email: clean(formData.get("email")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/vendors/${vendorId}`);
}

export async function removeVendorContact(vendorId: string, contactId: string) {
  await requireModule("vendors", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_contacts").delete().eq("id", contactId);
  if (error) throw new Error(error.message);
  revalidatePath(`/vendors/${vendorId}`);
}

// ───────────────────── GPT vendor-match review queue ─────────────────────

export async function dismissVendorSuggestion(id: string) {
  await requireModule("vendors", "edit", { mode: "throw" });
  const supabase = await createClient();
  await supabase.from("vendor_match_suggestions").update({ status: "dismissed" }).eq("id", id);
  revalidatePath("/vendors/review");
}

export async function applyVendorSuggestion(id: string) {
  await requireModule("vendors", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: s } = await supabase.from("vendor_match_suggestions").select("*").eq("id", id).maybeSingle();
  if (!s || s.status !== "pending") return;
  const proposed = (s.proposed ?? {}) as { corrected_name?: string; contact_name?: string; contact_phone?: string; contact_email?: string };

  const { data: ev } = await supabase
    .from("event_vendors")
    .select("id, vendor_id, contact_name, contact_phone, contact_email")
    .eq("id", s.event_vendor_id)
    .maybeSingle();
  if (!ev) {
    await supabase.from("vendor_match_suggestions").update({ status: "dismissed" }).eq("id", id);
    return;
  }

  // Only fill blanks — never overwrite what the couple typed.
  const evUpdate: Record<string, string> = {};
  if (proposed.contact_name && !ev.contact_name) evUpdate.contact_name = proposed.contact_name;
  if (proposed.contact_phone && !ev.contact_phone) evUpdate.contact_phone = proposed.contact_phone;
  if (proposed.contact_email && !ev.contact_email) evUpdate.contact_email = proposed.contact_email;

  if (s.kind === "merge" && s.matched_vendor_id && s.matched_vendor_id !== ev.vendor_id) {
    const oldVendorId = ev.vendor_id as string;
    await supabase.from("event_vendors").update({ ...evUpdate, vendor_id: s.matched_vendor_id }).eq("id", ev.id);
    // Remove the couple's duplicate vendor row if nothing else references it.
    const [{ count: evRefs }, { count: vcRefs }] = await Promise.all([
      supabase.from("event_vendors").select("id", { count: "exact", head: true }).eq("vendor_id", oldVendorId),
      supabase.from("vendor_contacts").select("id", { count: "exact", head: true }).eq("vendor_id", oldVendorId),
    ]);
    if ((evRefs ?? 0) === 0 && (vcRefs ?? 0) === 0) {
      await supabase.from("vendors").delete().eq("id", oldVendorId);
    }
  } else {
    if (Object.keys(evUpdate).length) await supabase.from("event_vendors").update(evUpdate).eq("id", ev.id);
    if (proposed.corrected_name && ev.vendor_id) {
      await supabase.from("vendors").update({ company_name: proposed.corrected_name }).eq("id", ev.vendor_id);
    }
  }

  await supabase.from("vendor_match_suggestions").update({ status: "applied" }).eq("id", id);
  revalidatePath("/vendors/review");
  revalidatePath("/vendors");
}
