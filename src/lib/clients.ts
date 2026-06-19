import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientInput = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  cell_phone?: string | null;
  organization?: string | null;
  mailing_address?: string | null;
  notes?: string | null;
  authorized_rep_name?: string | null;
  authorized_rep_title?: string | null;
  authorized_rep_email?: string | null;
  authorized_rep_phone?: string | null;
};

/* Dedupe clients by email. If a client with the same email already exists
   (case-insensitive), reuse it instead of creating a duplicate; otherwise
   insert a new one. Existing clients are reused as-is — their fields are not
   overwritten. Returns the resolved client id + name (needed for event naming).
   Note: ILIKE treats `_`/`%` as wildcards, so we confirm an exact (lowercased)
   match in JS rather than trusting the filter alone. */
export async function findOrCreateClient(
  supabase: SupabaseClient,
  input: ClientInput
): Promise<{ id: string; first_name: string; last_name: string }> {
  const email = (input.email ?? "").trim();
  if (email) {
    const { data: matches } = await supabase
      .from("clients")
      .select("id, first_name, last_name, email")
      .ilike("email", email)
      .limit(20);
    const exact = (matches ?? []).find((m) => (m.email ?? "").trim().toLowerCase() === email.toLowerCase());
    if (exact) {
      return { id: exact.id as string, first_name: (exact.first_name as string) ?? "", last_name: (exact.last_name as string) ?? "" };
    }
  }

  const row: Record<string, unknown> = {
    first_name: (input.first_name ?? "").trim() || "Client",
    last_name: (input.last_name ?? "").trim(),
    email: email || null,
    cell_phone: input.cell_phone ?? null,
  };
  if (input.organization !== undefined) row.organization = input.organization;
  if (input.mailing_address !== undefined) row.mailing_address = input.mailing_address;
  if (input.notes !== undefined) row.notes = input.notes;
  if (input.authorized_rep_name !== undefined) row.authorized_rep_name = input.authorized_rep_name;
  if (input.authorized_rep_title !== undefined) row.authorized_rep_title = input.authorized_rep_title;
  if (input.authorized_rep_email !== undefined) row.authorized_rep_email = input.authorized_rep_email;
  if (input.authorized_rep_phone !== undefined) row.authorized_rep_phone = input.authorized_rep_phone;

  const { data: created, error } = await supabase.from("clients").insert(row).select("id, first_name, last_name").single();
  if (error) throw new Error(error.message);
  return { id: created.id as string, first_name: created.first_name as string, last_name: created.last_name as string };
}
