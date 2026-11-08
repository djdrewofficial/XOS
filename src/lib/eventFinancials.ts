import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPackageSelection } from "@/lib/packageSelection";

export type EventFinancialInput = {
  packageId: string | null;
  /** null means "no manual override submitted". */
  packagePriceOverride: number | null;
  overrideSubmitted: boolean;
  deposit: number;
  overtime: number;
  travel: number;
  discount1: number;
  discount2: number;
};

/** Financials tab save: non-negative money fields, discounts clamped so the
    investment can't go negative, then package defaults when the package changes. */
export async function updateEventFinancialsRecord(supabase: SupabaseClient, eventId: string, input: EventFinancialInput) {
  const { data: before } = await supabase
    .from("events")
    .select("package_id, event_date, venue_id")
    .eq("id", eventId)
    .single();
  if (!before) throw new Error("Event not found.");
  const nn = (n: number) => Math.max(0, Number.isFinite(n) ? n : 0);
  const override = input.overrideSubmitted ? nn(input.packagePriceOverride ?? 0) : null;
  const deposit = nn(input.deposit);
  const overtime = nn(input.overtime);
  const travel = nn(input.travel);
  let discount1 = nn(input.discount1);
  let discount2 = nn(input.discount2);
  const pkgId = input.packageId ?? before.package_id ?? null;
  let pkgPrice = override ?? 0;
  if (override == null && pkgId) {
    const { data: pkg } = await supabase.from("packages").select("default_price").eq("id", pkgId).maybeSingle();
    pkgPrice = Number(pkg?.default_price ?? 0);
  }
  const [{ data: eAddons }, venueRes] = await Promise.all([
    supabase
      .from("event_addons")
      .select("quantity, price_override, price_locked, addon:addons(default_price)")
      .eq("event_id", eventId),
    before.venue_id
      ? supabase.from("venues").select("setup_fee").eq("id", before.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const addonsTotal = (eAddons ?? []).reduce((s, a) => {
    const unit = a.price_override ?? a.price_locked ?? (a.addon as { default_price?: number } | null)?.default_price ?? 0;
    return s + Number(a.quantity) * Number(unit);
  }, 0);
  const venueSetup = Number((venueRes.data as { setup_fee?: number } | null)?.setup_fee ?? 0);
  const subtotal = pkgPrice + overtime + travel + addonsTotal + venueSetup;
  if (subtotal > 0) {
    discount1 = Math.min(discount1, subtotal);
    discount2 = Math.min(discount2, Math.max(0, subtotal - discount1));
  }
  const { error } = await supabase
    .from("events")
    .update({
      package_id: input.packageId,
      package_price_override: override,
      deposit_value: deposit,
      overtime_fee: overtime,
      travel_fee: travel,
      discount1_amount: discount1,
      discount2_amount: discount2,
    })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  if (input.packageId && input.packageId !== before.package_id) {
    await applyPackageSelection(supabase, eventId, input.packageId, before.event_date ?? null, input.overrideSubmitted);
  }
}
