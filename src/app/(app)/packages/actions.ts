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

/* After a catalog save: "new" bumps current_version and snapshots it (events keep the
   version they signed with); "current" rewrites the latest snapshot in place (typo fix). */
async function snapshotVersion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "packages" | "addons",
  id: string,
  mode: string | null
) {
  const versionTable = table === "packages" ? "package_versions" : "addon_versions";
  const fk = table === "packages" ? "package_id" : "addon_id";
  const { data: row, error } = await supabase.from(table).select("*").eq("id", id).single();
  if (error || !row) return;

  // pre-migration-00030 safety: if the version tables aren't there yet, save normally
  const tolerate = (msg: string) => /could not find|does not exist|schema cache/i.test(msg);

  if (mode === "new") {
    const newVersion = (row.current_version ?? 1) + 1;
    const { error: bumpError } = await supabase
      .from(table)
      .update({ current_version: newVersion })
      .eq("id", id);
    if (bumpError) {
      if (tolerate(bumpError.message)) return;
      throw new Error(bumpError.message);
    }
    const { error: insError } = await supabase.from(versionTable).insert({
      [fk]: id,
      version_no: newVersion,
      snapshot: { ...row, current_version: newVersion },
    });
    if (insError && !tolerate(insError.message)) throw new Error(insError.message);
  } else {
    const { error: upError } = await supabase.from(versionTable).upsert(
      { [fk]: id, version_no: row.current_version ?? 1, snapshot: row },
      { onConflict: `${fk},version_no` }
    );
    if (upError && !tolerate(upError.message)) throw new Error(upError.message);
  }
}

export async function createPackage(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("packages")
    .insert({
      name: clean(formData.get("name")) ?? "New Package",
      category_id: clean(formData.get("category_id")),
      default_price: num(formData.get("default_price")),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
  redirect(`/packages/${data.id}`);
}

export async function deletePackage(id: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("package_id", id);
  if ((count ?? 0) > 0) {
    throw new Error("Package is used on events — deactivate it instead of deleting.");
  }
  const { error } = await supabase.from("packages").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
}

export async function createPackageCategory(packageId: string | null, formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("package_categories").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
  if (packageId) revalidatePath(`/packages/${packageId}`);
}

export async function updatePackageCategory(id: string, formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase
    .from("package_categories")
    .update({ name, is_active: formData.get("is_active") === "on" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
}

export async function deletePackageCategory(id: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("packages")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if ((count ?? 0) > 0) {
    throw new Error("Category has packages in it — move them first or deactivate the category.");
  }
  const { error } = await supabase.from("package_categories").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
}

/* ---------- ADD-ON CATEGORIES ---------- */
export async function createAddonCategory(formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("addon_categories").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
}

export async function updateAddonCategory(id: string, formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase
    .from("addon_categories")
    .update({ name, is_active: formData.get("is_active") === "on" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
}

export async function deleteAddonCategory(id: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("addons")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if ((count ?? 0) > 0) {
    throw new Error("Category has add-ons in it — move them first or deactivate the category.");
  }
  const { error } = await supabase.from("addon_categories").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
}

/* ---------- ADD-ONS ---------- */
export async function createAddon(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("addons")
    .insert({
      name: clean(formData.get("name")) ?? "New Add-On",
      category_id: clean(formData.get("category_id")),
      default_price: num(formData.get("default_price")),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
  redirect(`/addons/${data.id}`);
}

export async function updateAddonSettings(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("addons")
    .update({
      name: clean(formData.get("name")) ?? "Unnamed",
      client_facing_name: clean(formData.get("client_facing_name")),
      category_id: clean(formData.get("category_id")),
      default_price: num(formData.get("default_price")),
      description: clean(formData.get("description")),
      notes: clean(formData.get("notes")),
      commission_eligible: formData.get("commission_eligible") === "on",
      display_order: parseInt(clean(formData.get("display_order")) ?? "0") || 0,
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await snapshotVersion(supabase, "addons", id, clean(formData.get("version_mode")));
  revalidatePath(`/addons/${id}`);
  revalidatePath("/packages");
}

export async function deleteAddon(id: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("event_addons")
    .select("id", { count: "exact", head: true })
    .eq("addon_id", id);
  if ((count ?? 0) > 0) {
    throw new Error("Add-on is used on events — deactivate it instead of deleting.");
  }
  const { error } = await supabase.from("addons").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
  redirect("/packages");
}

export async function saveAddonEquipmentDefaults(addonId: string, formData: FormData) {
  const supabase = await createClient();
  await supabase.from("addon_equipment_defaults").delete().eq("addon_id", addonId);
  const rows: { addon_id: string; item_id: string | null; system_id: string | null; quantity: number }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (key.startsWith("system_") && raw === "on") {
      rows.push({ addon_id: addonId, item_id: null, system_id: key.slice(7), quantity: 1 });
    } else if (key.startsWith("item_")) {
      const qty = parseInt(raw.toString());
      if (Number.isFinite(qty) && qty > 0) {
        rows.push({ addon_id: addonId, item_id: key.slice(5), system_id: null, quantity: qty });
      }
    }
  }
  if (rows.length) {
    const { error } = await supabase.from("addon_equipment_defaults").insert(rows);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/addons/${addonId}`);
}

export async function updatePackageGeneral(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("packages")
    .update({
      name: clean(formData.get("name")) ?? "Unnamed",
      client_facing_name: clean(formData.get("client_facing_name")),
      category_id: clean(formData.get("category_id")),
      description: clean(formData.get("description")),
      notes: clean(formData.get("notes")),
      display_order: parseInt(clean(formData.get("display_order")) ?? "0") || 0,
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await snapshotVersion(supabase, "packages", id, clean(formData.get("version_mode")));
  revalidatePath(`/packages/${id}`);
  revalidatePath("/packages");
}

export async function updatePackageFinancials(id: string, formData: FormData) {
  const supabase = await createClient();
  const splits = formData
    .getAll("allowed_splits")
    .map((v) => parseInt(v.toString()))
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  const terms = formData.get("payment_terms")?.toString() ?? "days_before";

  // weekday prices: weekday_0 … weekday_6, blank = no override for that day
  const weekday: Record<string, number> = {};
  for (let d = 0; d <= 6; d++) {
    const v = clean(formData.get(`weekday_${d}`));
    if (v) weekday[String(d)] = num(formData.get(`weekday_${d}`));
  }

  const depositMode = formData.get("deposit_mode")?.toString() ?? "fixed";

  const { error } = await supabase
    .from("packages")
    .update({
      is_taxable: formData.get("is_taxable") === "on",
      is_hourly: formData.get("is_hourly") === "on",
      hourly_rate: num(formData.get("hourly_rate")),
      default_price: num(formData.get("default_price")),
      included_hours: num(formData.get("included_hours")),
      overtime_hourly: num(formData.get("overtime_hourly")),
      overtime_half_hourly: num(formData.get("overtime_half_hourly")),
      deposit_value: depositMode === "fixed" ? num(formData.get("deposit_value")) : 0,
      deposit_pct: depositMode === "pct" ? num(formData.get("deposit_pct")) : null,
      weekday_prices: weekday,
      allowed_splits: splits.length ? splits : [1, 2, 3],
      payment_terms: terms === "net_days_after" ? "net_days_after" : "days_before",
      payment_terms_days: parseInt(formData.get("payment_terms_days")?.toString() ?? "30") || 30,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await snapshotVersion(supabase, "packages", id, clean(formData.get("version_mode")));
  revalidatePath(`/packages/${id}`);
  revalidatePath("/packages");
}

export async function addDatePrice(packageId: string, formData: FormData) {
  const supabase = await createClient();
  const start = clean(formData.get("start_date"));
  const end = clean(formData.get("end_date"));
  if (!start) return;
  const { error } = await supabase.from("package_date_prices").insert({
    package_id: packageId,
    label: clean(formData.get("label")),
    start_date: start,
    end_date: end ?? start,
    price: num(formData.get("price")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/packages/${packageId}`);
}

export async function deleteDatePrice(packageId: string, priceId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("package_date_prices").delete().eq("id", priceId);
  if (error) throw new Error(error.message);
  revalidatePath(`/packages/${packageId}`);
}

export async function saveAddonDefaults(packageId: string, formData: FormData) {
  const supabase = await createClient();
  // fields arrive as addon_<addonId> = quantity (blank/0 = not assigned)
  await supabase.from("package_addon_defaults").delete().eq("package_id", packageId);
  const rows: { package_id: string; addon_id: string; quantity: number }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("addon_")) continue;
    const qty = parseInt(raw.toString());
    if (Number.isFinite(qty) && qty > 0) {
      rows.push({ package_id: packageId, addon_id: key.slice(6), quantity: qty });
    }
  }
  if (rows.length) {
    const { error } = await supabase.from("package_addon_defaults").insert(rows);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/packages/${packageId}`);
}

export async function saveEquipmentDefaults(packageId: string, formData: FormData) {
  const supabase = await createClient();
  // system_<id> = "on" checkboxes; item_<id> = quantity inputs
  await supabase.from("package_equipment_defaults").delete().eq("package_id", packageId);
  const rows: { package_id: string; item_id: string | null; system_id: string | null; quantity: number }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (key.startsWith("system_") && raw === "on") {
      rows.push({ package_id: packageId, item_id: null, system_id: key.slice(7), quantity: 1 });
    } else if (key.startsWith("item_")) {
      const qty = parseInt(raw.toString());
      if (Number.isFinite(qty) && qty > 0) {
        rows.push({ package_id: packageId, item_id: key.slice(5), system_id: null, quantity: qty });
      }
    }
  }
  if (rows.length) {
    const { error } = await supabase.from("package_equipment_defaults").insert(rows);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/packages/${packageId}`);
}
