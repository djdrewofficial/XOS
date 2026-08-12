"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModule } from "@/lib/auth";
import { sendAccountInvite, sendPasswordReset } from "@/lib/accounts";
import { formatPhone, toE164 } from "@/lib/phone";
import { recordSmsOptSignal } from "@/lib/smsOptOut";
import { findOrCreateClient } from "@/lib/clients";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

/** Pragmatic email-shape check — catches real typos (missing @, no domain dot,
    spaces) without chasing full RFC 5322. */
function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
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

/** Manually set a client's SMS opt-out state (STOP suppression). Use only when a
    client asks staff directly — inbound STOP/START replies are handled
    automatically. Staff-only (clients:edit); the manual signal timestamps to now
    so it overrides any older inbound message. */
export async function setClientSmsOptOut(id: string, optedOut: boolean): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireModule("clients", "edit", { mode: "throw", supabase });
  const { data: c } = await supabase.from("clients").select("cell_phone").eq("id", id).maybeSingle();
  if (!c?.cell_phone) return { ok: false, error: "No mobile number on file for this client." };
  const res = await recordSmsOptSignal(supabase, c.cell_phone, {
    optedOut,
    source: "manual",
    reason: optedOut ? "Opted out by staff" : "Re-subscribed by staff",
  });
  if (!res.ok) return { ok: false, error: "That mobile number isn't a valid US number." };
  revalidatePath(`/clients/${id}`);
  return { ok: true };
}

/** Record (or revoke) a client's consent to receive marketing/promotional text
    messages — TCPA prior-express-consent capture. Timestamps sms_opt_in_at so we
    have a dated record of consent; marketing SMS are gated on it at send time
    (processSmsOutbox). Distinct from the STOP suppression list. Staff-gated. */
export async function setClientSmsConsent(id: string, consented: boolean): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireModule("clients", "edit", { mode: "throw", supabase });
  const { error } = await supabase
    .from("clients")
    .update({
      sms_opt_in: consented,
      sms_opt_in_at: consented ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/clients/${id}`);
  return { ok: true };
}

/** Honor a "delete my data" (GDPR/CCPA right-to-erasure) request: scrub the
    client's PII in place and remove their portal login, while KEEPING the row so
    their events and payment history stay attributable (financial records are
    retained under a separate legal basis). Irreversible. Staff-gated (clients:edit).
    Comms logs (SMS/email history) are retained as business records. */
export async function anonymizeClient(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireModule("clients", "edit", { mode: "throw", supabase });
  const admin = createAdminClient();

  const { error: upErr } = await admin
    .from("clients")
    .update({
      first_name: "Deleted",
      last_name: "Client",
      organization: null,
      cell_phone: null,
      email: null,
      mailing_address: null,
      anniversary: null,
      notes: null,
      instagram: null,
      tiktok: null,
      authorized_rep_name: null,
      authorized_rep_title: null,
      authorized_rep_email: null,
      authorized_rep_phone: null,
      anonymized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (upErr) return { ok: false, error: upErr.message };

  // Remove their portal login. Deleting the auth user cascades the accounts row
  // (accounts.auth_user_id references auth.users on delete cascade).
  const { data: acct } = await admin
    .from("accounts")
    .select("auth_user_id")
    .eq("account_type", "client")
    .eq("client_id", id)
    .maybeSingle();
  if (acct?.auth_user_id) {
    try {
      await admin.auth.admin.deleteUser(acct.auth_user_id as string);
    } catch {
      /* best-effort — the PII is already scrubbed; a stale auth row can be cleaned up manually */
    }
  }

  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  return { ok: true };
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
  const email = clean(formData.get("email"));
  const repEmail = clean(formData.get("authorized_rep_email"));
  const repPhone = clean(formData.get("authorized_rep_phone"));

  // Reject typo'd contact info before it enters the CRM — a bad email or phone
  // silently breaks proposal/contract email + SMS delivery. Empty is fine (these
  // are optional); phones use the same US/E.164 rule as the SMS pipeline (toE164),
  // so an international number must include a leading +.
  const invalid: string[] = [];
  if (email && !isEmail(email)) invalid.push("email address");
  if (repEmail && !isEmail(repEmail)) invalid.push("authorized rep email");
  if (phone && !toE164(phone)) invalid.push("mobile number");
  if (repPhone && !toE164(repPhone)) invalid.push("authorized rep phone");
  if (invalid.length) {
    throw new Error(`Please enter a valid ${invalid.join(" and ")} (or leave it blank).`);
  }

  return {
    first_name: clean(formData.get("first_name")) ?? "",
    last_name: clean(formData.get("last_name")) ?? "",
    organization: clean(formData.get("organization")),
    cell_phone: cs?.phone_format_enabled === false ? phone : formatPhone(phone),
    email,
    mailing_address: clean(formData.get("mailing_address")),
    instagram: normalizeHandle(clean(formData.get("instagram"))),
    tiktok: normalizeHandle(clean(formData.get("tiktok"))),
    authorized_rep_name: clean(formData.get("authorized_rep_name")),
    authorized_rep_title: clean(formData.get("authorized_rep_title")),
    authorized_rep_email: repEmail,
    authorized_rep_phone: repPhone,
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
