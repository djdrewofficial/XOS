"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { sendAccountInvite, sendPasswordReset } from "@/lib/accounts";
import { formatPhone } from "@/lib/phone";
import { findOrCreateClient } from "@/lib/clients";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

/** Invite a client to the planning portal (creates/ensures their login). */
export async function inviteClient(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireModule("clients", "edit", { mode: "throw", supabase });
  const { data: c } = await supabase
    .from("clients")
    .select("email, first_name")
    .eq("id", id)
    .maybeSingle();
  if (!c?.email) return { ok: false, error: "Add an email to this client first." };
  const res = await sendAccountInvite({ type: "client", email: c.email, name: c.first_name, clientId: id });
  if (res.ok) revalidatePath(`/clients/${id}`);
  return res;
}

/** Email a portal password-reset link to a client. */
export async function resetClientPassword(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireModule("clients", "edit", { mode: "throw", supabase });
  const { data: c } = await supabase.from("clients").select("email").eq("id", id).maybeSingle();
  if (!c?.email) return { ok: false, error: "No email on file." };
  return await sendPasswordReset(c.email);
}

async function payload(supabase: Awaited<ReturnType<typeof createClient>>, formData: FormData) {
  await requireModule("clients", "edit", { mode: "throw" });
  // phone auto-formatting (612-555-1212) — General settings toggle
  const { data: cs } = await supabase
    .from("company_settings")
    .select("phone_format_enabled")
    .eq("id", true)
    .maybeSingle();
  const phone = clean(formData.get("cell_phone"));
  return {
    first_name: clean(formData.get("first_name")) ?? "",
    last_name: clean(formData.get("last_name")) ?? "",
    organization: clean(formData.get("organization")),
    cell_phone: cs?.phone_format_enabled === false ? phone : formatPhone(phone),
    email: clean(formData.get("email")),
    mailing_address: clean(formData.get("mailing_address")),
    instagram: normalizeHandle(clean(formData.get("instagram"))),
    tiktok: normalizeHandle(clean(formData.get("tiktok"))),
    authorized_rep_name: clean(formData.get("authorized_rep_name")),
    authorized_rep_title: clean(formData.get("authorized_rep_title")),
    authorized_rep_email: clean(formData.get("authorized_rep_email")),
    authorized_rep_phone: clean(formData.get("authorized_rep_phone")),
    notes: clean(formData.get("notes")),
  };
}

/** Store social handles as a bare @handle (strip URLs / leading @). */
function normalizeHandle(v: string | null): string | null {
  if (!v) return null;
  let h = v.trim();
  h = h.replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\//i, "");
  h = h.replace(/[/?#].*$/, "").replace(/^@+/, "").trim();
  return h ? `@${h}` : null;
}

export async function createClientRecord(formData: FormData) {
  await requireModule("clients", "edit", { mode: "throw" });
  const supabase = await createClient();
  // dedupe by email — if this email already exists, open that client instead
  const { id } = await findOrCreateClient(supabase, await payload(supabase, formData));
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function updateClientRecord(id: string, formData: FormData) {
  await requireModule("clients", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update(await payload(supabase, formData))
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}
