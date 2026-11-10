import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolve an inquiry source the way event create/update should: by id, or by
    exact name against inquiry_sources. Never creates a source. */
export async function resolveInquirySourceId(
  admin: SupabaseClient,
  args: { inquiry_source_id?: unknown; inquiry_source_name?: unknown },
): Promise<{ provided: false } | { provided: true; id: string }> {
  const id =
    typeof args.inquiry_source_id === "string" && args.inquiry_source_id.trim()
      ? args.inquiry_source_id.trim()
      : null;
  const name =
    typeof args.inquiry_source_name === "string" && args.inquiry_source_name.trim()
      ? args.inquiry_source_name.trim()
      : null;
  if (!id && !name) return { provided: false };

  if (id) {
    const { data, error } = await admin.from("inquiry_sources").select("id, name").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error(`Inquiry source was not found for id ${id}.`);
    if (name && data.name !== name) {
      throw new Error(`Inquiry source id does not match the name "${name}".`);
    }
    return { provided: true, id: data.id as string };
  }

  const { data, error } = await admin.from("inquiry_sources").select("id").eq("name", name!).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) {
    throw new Error(`Inquiry source named "${name}" was not found. Use an existing source; sources are not created here.`);
  }
  return { provided: true, id: data.id as string };
}

/** Insert an event row, applying an optional resolved inquiry source. */
export async function insertEventWithInquirySource(
  admin: SupabaseClient,
  row: Record<string, unknown>,
  args: { inquiry_source_id?: unknown; inquiry_source_name?: unknown },
): Promise<{ id: string; inquiry_source_id: string | null }> {
  const source = await resolveInquirySourceId(admin, args);
  const { data, error } = await admin
    .from("events")
    .insert({
      ...row,
      inquiry_source_id: source.provided ? source.id : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, inquiry_source_id: source.provided ? source.id : null };
}

/** Patch an event, applying inquiry source when id or name was provided. */
export async function updateEventWithInquirySource(
  admin: SupabaseClient,
  eventId: string,
  patch: Record<string, unknown>,
  args: { inquiry_source_id?: unknown; inquiry_source_name?: unknown },
): Promise<{ ok: true; inquiry_source_id?: string }> {
  const source = await resolveInquirySourceId(admin, args);
  const next = { ...patch };
  if (source.provided) next.inquiry_source_id = source.id;
  const { error } = await admin.from("events").update(next).eq("id", eventId);
  if (error) throw new Error(error.message);
  return source.provided ? { ok: true, inquiry_source_id: source.id } : { ok: true };
}
