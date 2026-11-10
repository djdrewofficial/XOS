import type { SupabaseClient } from "@supabase/supabase-js";
import type { JsonSchema } from "./validate";

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Resolve an inquiry source by id, or by exact case-sensitive name against
    inquiry_sources. Never creates a source. Errors when id and name disagree. */
export async function resolveInquirySourceId(
  admin: SupabaseClient,
  args: { inquiry_source_id?: unknown; inquiry_source_name?: unknown },
): Promise<{ provided: false } | { provided: true; id: string; name: string }> {
  const id = trimString(args.inquiry_source_id);
  const name = trimString(args.inquiry_source_name);
  if (!id && !name) return { provided: false };

  if (id) {
    const { data, error } = await admin.from("inquiry_sources").select("id, name").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error(`Inquiry source was not found for id ${id}.`);
    if (name && data.name !== name) {
      throw new Error(`Inquiry source id does not match the exact name "${name}".`);
    }
    return { provided: true, id: data.id as string, name: data.name as string };
  }

  const { data, error } = await admin.from("inquiry_sources").select("id, name").eq("name", name!).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) {
    throw new Error(
      `Inquiry source named "${name}" was not found (exact, case-sensitive match). Use events_form_options to list sources, or create one with sources_save / new_source_name.`,
    );
  }
  return { provided: true, id: data.id as string, name: data.name as string };
}

/** Find a source whose trimmed name matches case-insensitively. */
export async function findInquirySourceByNameInsensitive(
  admin: SupabaseClient,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const needle = name.trim();
  if (!needle) return null;
  const { data, error } = await admin.from("inquiry_sources").select("id, name");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; name: string }[];
  const match = rows.find((row) => row.name.trim().toLowerCase() === needle.toLowerCase());
  return match ? { id: match.id, name: match.name } : null;
}

/** Create a source, or reuse one that already matches the trimmed name case-insensitively. */
export async function createOrReuseInquirySource(
  admin: SupabaseClient,
  input: { name: string; isActive?: boolean },
): Promise<{ id: string; name: string; created: boolean }> {
  const name = input.name.trim();
  if (!name) throw new Error("Inquiry source name is required.");
  const existing = await findInquirySourceByNameInsensitive(admin, name);
  if (existing) return { id: existing.id, name: existing.name, created: false };
  const { data, error } = await admin
    .from("inquiry_sources")
    .insert({ name, is_active: input.isActive !== false })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, name: data.name as string, created: true };
}

type EventSourceArgs = {
  inquiry_source_id?: unknown;
  inquiry_source_name?: unknown;
  new_source_name?: unknown;
  new_source_persist?: unknown;
};

type PlannedSource =
  | { provided: false }
  | { provided: true; id: string; created: false }
  | { provided: true; id: null; created: true; newName: string; persist: boolean };

/**
 * Plan an event inquiry source without inserting.
 * - inquiry_source_id / inquiry_source_name: exact existing lookup (never insert)
 * - new_source_name: reuse a trimmed case-insensitive match, or mark created=true
 * Rejects when those inputs point at different sources.
 */
export async function planEventInquirySource(
  admin: SupabaseClient,
  args: EventSourceArgs,
): Promise<PlannedSource> {
  const existing = await resolveInquirySourceId(admin, args);
  const newName = trimString(args.new_source_name);
  if (!newName) {
    if (!existing.provided) return { provided: false };
    return { provided: true, id: existing.id, created: false };
  }

  const reused = await findInquirySourceByNameInsensitive(admin, newName);
  if (existing.provided) {
    if (reused) {
      if (reused.id !== existing.id) {
        throw new Error(
          `Inquiry source inputs conflict: existing source "${existing.name}" does not match new_source_name "${newName}".`,
        );
      }
      return { provided: true, id: existing.id, created: false };
    }
    throw new Error(
      `Inquiry source inputs conflict: an existing source was selected, but new_source_name "${newName}" does not match it.`,
    );
  }

  if (reused) return { provided: true, id: reused.id, created: false };
  return {
    provided: true,
    id: null,
    created: true,
    newName,
    persist: args.new_source_persist === true,
  };
}

/** Resolve for execute: same as plan, and inserts when a new source is required. */
export async function resolveEventInquirySource(
  admin: SupabaseClient,
  args: EventSourceArgs,
): Promise<{ provided: false } | { provided: true; id: string; created: boolean }> {
  const planned = await planEventInquirySource(admin, args);
  if (!planned.provided) return { provided: false };
  if (!planned.created) return { provided: true, id: planned.id, created: false };
  const created = await createOrReuseInquirySource(admin, {
    name: planned.newName,
    isActive: planned.persist,
  });
  return { provided: true, id: created.id, created: created.created };
}

/** Schema property for MCP: exact case-sensitive name of an existing source. */
export const INQUIRY_SOURCE_NAME_SCHEMA: JsonSchema = {
  type: "string",
  minLength: 1,
  description:
    "Exact, case-sensitive name of an existing inquiry source. Unknown names are rejected; this field never creates a source. List sources with events_form_options first.",
};

export const NEW_SOURCE_NAME_SCHEMA: JsonSchema = {
  type: "string",
  minLength: 1,
  description:
    "Create a new inquiry source only when nothing matches. Trimmed names that already exist (any case) are reused. Prefer listing with events_form_options and picking a match first.",
};

/** Insert an event row, applying an optional resolved inquiry source (id or exact name only). */
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

/** Patch an event, applying inquiry source when id or exact name was provided. */
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
