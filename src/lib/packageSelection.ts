import type { SupabaseClient } from "@supabase/supabase-js";
import { assignAddonSections } from "@/lib/planning";

/** Date-aware package price, deposit default, and the package's default add-ons
    and equipment. Shared by the event form and the MCP connector. */
export async function applyPackageSelection(
  supabase: SupabaseClient,
  eventId: string,
  packageId: string,
  eventDate: string | null,
  manualOverride: boolean,
) {
  const { data: pkg } = await supabase
    .from("packages")
    .select("default_price, deposit_value, deposit_pct, weekday_prices")
    .eq("id", packageId)
    .single();
  if (!pkg) return;

  let effective = Number(pkg.default_price);
  if (eventDate) {
    const weekday = (pkg.weekday_prices as Record<string, number> | null) ?? {};
    const [y, m, d] = eventDate.split("-").map(Number);
    const dow = String(new Date(y, m - 1, d).getDay());
    if (weekday[dow] !== undefined) effective = Number(weekday[dow]);

    const { data: ranges } = await supabase
      .from("package_date_prices")
      .select("price")
      .eq("package_id", packageId)
      .lte("start_date", eventDate)
      .gte("end_date", eventDate)
      .order("created_at", { ascending: false })
      .limit(1);
    if (ranges && ranges.length) effective = Number(ranges[0].price);
  }

  const updates: Record<string, unknown> = {};
  if (!manualOverride) {
    updates.package_price_override = effective !== Number(pkg.default_price) ? effective : null;
  }
  const { data: ev } = await supabase.from("events").select("deposit_value").eq("id", eventId).single();
  if (ev && Number(ev.deposit_value) === 0) {
    if (pkg.deposit_pct != null && Number(pkg.deposit_pct) > 0) {
      updates.deposit_value = Math.round(effective * Number(pkg.deposit_pct)) / 100;
    } else if (Number(pkg.deposit_value) > 0) {
      updates.deposit_value = Number(pkg.deposit_value);
    }
  }
  if (Object.keys(updates).length) {
    await supabase.from("events").update(updates).eq("id", eventId);
  }

  const { data: addonDefaults } = await supabase
    .from("package_addon_defaults")
    .select("addon_id, quantity")
    .eq("package_id", packageId);
  if (addonDefaults?.length) {
    const { data: existing } = await supabase.from("event_addons").select("addon_id").eq("event_id", eventId);
    const have = new Set((existing ?? []).map((x) => x.addon_id));
    const rows = addonDefaults
      .filter((a) => !have.has(a.addon_id))
      .map((a) => ({ event_id: eventId, addon_id: a.addon_id, quantity: a.quantity }));
    if (rows.length) await supabase.from("event_addons").insert(rows);
    for (const r of rows) {
      await assignAddonEquipment(supabase, eventId, r.addon_id);
      await assignAddonSections(eventId, r.addon_id);
    }
  }

  const { data: equipDefaults } = await supabase
    .from("package_equipment_defaults")
    .select("item_id, system_id, quantity")
    .eq("package_id", packageId);
  if (equipDefaults?.length) {
    const { data: existing } = await supabase.from("event_equipment").select("item_id, system_id").eq("event_id", eventId);
    const haveItems = new Set((existing ?? []).map((x) => x.item_id).filter(Boolean));
    const haveSystems = new Set((existing ?? []).map((x) => x.system_id).filter(Boolean));
    const rows = equipDefaults
      .filter((e) => (e.item_id ? !haveItems.has(e.item_id) : !haveSystems.has(e.system_id)))
      .map((e) => ({
        event_id: eventId,
        item_id: e.item_id,
        system_id: e.system_id,
        quantity: e.quantity,
      }));
    if (rows.length) await supabase.from("event_equipment").insert(rows);
  }
}

export async function assignAddonEquipment(supabase: SupabaseClient, eventId: string, addonId: string) {
  const { data: defaults } = await supabase
    .from("addon_equipment_defaults")
    .select("item_id, system_id, quantity")
    .eq("addon_id", addonId);
  if (!defaults?.length) return;
  const { data: existing } = await supabase.from("event_equipment").select("item_id, system_id").eq("event_id", eventId);
  const haveItems = new Set((existing ?? []).map((x) => x.item_id).filter(Boolean));
  const haveSystems = new Set((existing ?? []).map((x) => x.system_id).filter(Boolean));
  const rows = defaults
    .filter((e) => (e.item_id ? !haveItems.has(e.item_id) : !haveSystems.has(e.system_id)))
    .map((e) => ({ event_id: eventId, item_id: e.item_id, system_id: e.system_id, quantity: e.quantity }));
  if (rows.length) await supabase.from("event_equipment").insert(rows);
}
