import type { SupabaseClient } from "@supabase/supabase-js";

/** Columns that exist on public.vendors (no email/phone — those live on vendor_contacts). */
export const VENDOR_TABLE_COLUMNS = [
  "id",
  "company_name",
  "category",
  "category_id",
  "notes",
  "created_at",
  "is_preferred",
  "website",
  "instagram",
  "tiktok",
  "youtube",
  "social_collab",
] as const;

export const VENDOR_WRITABLE_COLUMNS = [
  "company_name",
  "category",
  "category_id",
  "notes",
  "is_preferred",
  "website",
  "instagram",
  "tiktok",
  "youtube",
  "social_collab",
] as const;

/** Explicit FK so PostgREST embeds contacts even if multiple relationships exist later. */
export const VENDOR_CONTACTS_EMBED =
  "vendor_contacts!vendor_contacts_vendor_id_fkey(id, name, role, email, phone)";

export const VENDOR_COLUMNS_SELECT = [
  "id",
  "company_name",
  "category",
  "category_id",
  "notes",
  "created_at",
  "is_preferred",
  "website",
  "instagram",
  "tiktok",
  "youtube",
  "social_collab",
].join(", ");

export const VENDOR_LIST_SELECT = `${VENDOR_COLUMNS_SELECT}, ${VENDOR_CONTACTS_EMBED}`;

/** Role strings the event Vendors tab and planner UI commonly offer (free text still allowed). */
export const EVENT_VENDOR_ROLE_EXAMPLES = [
  "Photographer",
  "Videographer",
  "Wedding Planner",
  "Day-of Coordinator",
  "Florist",
  "Caterer",
  "Venue Coordinator",
  "Venue",
  "Hair & Makeup",
  "Officiant",
  "Rentals",
  "Cake / Desserts",
  "Transportation",
  "Live Musician",
  "Other",
  "Vendor",
] as const;

const CONTACT_ARGS = ["email", "phone", "contact_name", "contact_role"] as const;

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function escapeIlike(term: string): string {
  return term.replace(/[%(),]/g, "");
}

function vendorInsertPatch(args: Record<string, unknown>): Record<string, unknown> {
  const companyName = str(args, "company_name");
  if (!companyName) throw new Error("company_name is required.");
  const row: Record<string, unknown> = { company_name: companyName };
  for (const key of VENDOR_WRITABLE_COLUMNS) {
    if (key === "company_name") continue;
    if (!(key in args)) continue;
    if (key === "is_preferred") {
      if (typeof args.is_preferred === "boolean") row.is_preferred = args.is_preferred;
      continue;
    }
    row[key] = str(args, key);
  }
  return row;
}

function vendorUpdatePatch(args: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of VENDOR_WRITABLE_COLUMNS) {
    if (!(key in args)) continue;
    if (key === "is_preferred") {
      if (typeof args.is_preferred === "boolean") patch.is_preferred = args.is_preferred;
      continue;
    }
    patch[key] = str(args, key);
  }
  return patch;
}

function hasContactArgs(args: Record<string, unknown>): boolean {
  return CONTACT_ARGS.some((key) => key in args && args[key] != null && String(args[key]).trim() !== "");
}

function contactPayload(args: Record<string, unknown>, fallbackName: string): Record<string, unknown> {
  const name = str(args, "contact_name") ?? fallbackName;
  if (!name) throw new Error("A contact needs a name (pass contact_name, or company_name as a fallback).");
  return {
    name,
    role: str(args, "contact_role"),
    email: str(args, "email"),
    phone: str(args, "phone"),
  };
}

export async function listVendors(
  admin: SupabaseClient,
  args: Record<string, unknown>,
): Promise<{ vendors: unknown[]; limit: number; returned: number; may_have_more: boolean }> {
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.max(1, Math.min(200, Math.round(args.limit))) : 50;
  let q = admin.from("vendors").select(VENDOR_LIST_SELECT).order("company_name").limit(limit);
  const term = str(args, "q");
  if (term) {
    const safe = escapeIlike(term);
    const { data: hits, error: contactError } = await admin
      .from("vendor_contacts")
      .select("vendor_id")
      .or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
      .limit(200);
    if (contactError) throw new Error(contactError.message);
    const ids = [...new Set((hits ?? []).map((row) => (row as { vendor_id?: string }).vendor_id).filter((id): id is string => !!id))];
    if (ids.length) {
      q = q.or(`company_name.ilike.%${safe}%,id.in.(${ids.join(",")})`);
    } else {
      q = q.ilike("company_name", `%${safe}%`);
    }
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const vendors = Array.isArray(data) ? data : [];
  return { vendors, limit, returned: vendors.length, may_have_more: vendors.length >= limit };
}

export async function createVendor(
  admin: SupabaseClient,
  args: Record<string, unknown>,
): Promise<{ id: string; vendor: Record<string, unknown>; contact: Record<string, unknown> | null }> {
  const row = vendorInsertPatch(args);
  const { data: vendor, error } = await admin.from("vendors").insert(row).select(VENDOR_COLUMNS_SELECT).single();
  if (error) throw new Error(error.message);
  const vendorRow = vendor as unknown as Record<string, unknown>;
  const id = String(vendorRow.id);
  if (!hasContactArgs(args)) return { id, vendor: vendorRow, contact: null };

  const contactRow = {
    vendor_id: id,
    ...contactPayload(args, String(vendorRow.company_name ?? row.company_name)),
  };
  const { data: contact, error: contactError } = await admin
    .from("vendor_contacts")
    .insert(contactRow)
    .select("id, name, role, email, phone, vendor_id")
    .single();
  if (contactError) throw new Error(contactError.message);
  return { id, vendor: vendorRow, contact: contact as unknown as Record<string, unknown> };
}

export async function updateVendor(
  admin: SupabaseClient,
  args: Record<string, unknown>,
): Promise<{ ok: true; contact: Record<string, unknown> | null }> {
  const vendorId = str(args, "vendor_id");
  if (!vendorId) throw new Error("vendor_id is required.");

  const patch = vendorUpdatePatch(args);
  if (Object.keys(patch).length) {
    const { error } = await admin.from("vendors").update(patch).eq("id", vendorId);
    if (error) throw new Error(error.message);
  }

  if (!hasContactArgs(args)) return { ok: true, contact: null };

  const { data: existing, error: findError } = await admin
    .from("vendor_contacts")
    .select("id, name")
    .eq("vendor_id", vendorId)
    .order("name")
    .limit(1)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  let fallbackName = str(args, "company_name") ?? (existing as { name?: string } | null)?.name ?? null;
  if (!fallbackName) {
    const { data: vendorRow, error: vendorError } = await admin
      .from("vendors")
      .select("company_name")
      .eq("id", vendorId)
      .maybeSingle();
    if (vendorError) throw new Error(vendorError.message);
    fallbackName = (vendorRow as { company_name?: string } | null)?.company_name ?? "Contact";
  }
  const payload = contactPayload(args, fallbackName);

  if (existing?.id) {
    const { data: contact, error } = await admin
      .from("vendor_contacts")
      .update(payload)
      .eq("id", existing.id)
      .eq("vendor_id", vendorId)
      .select("id, name, role, email, phone, vendor_id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, contact: contact as unknown as Record<string, unknown> };
  }

  const { data: contact, error } = await admin
    .from("vendor_contacts")
    .insert({ vendor_id: vendorId, ...payload })
    .select("id, name, role, email, phone, vendor_id")
    .single();
  if (error) throw new Error(error.message);
  return { ok: true, contact: contact as unknown as Record<string, unknown> };
}

/** Assert a vendors insert/update payload never touches nonexistent email/phone columns. */
export function assertVendorPayloadColumns(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (key === "email" || key === "phone") {
      throw new Error(`vendors.${key} does not exist; use vendor_contacts instead.`);
    }
    if (!(VENDOR_WRITABLE_COLUMNS as readonly string[]).includes(key) && key !== "id") {
      throw new Error(`Unknown vendors column: ${key}`);
    }
  }
}
