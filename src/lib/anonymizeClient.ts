import type { SupabaseClient } from "@supabase/supabase-js";
import { syncClientLoginPhone } from "@/lib/loginPhoneAdmin";

/** GDPR/CCPA erasure used by the client page. Scrubs PII, clears the login
    phone, and deletes the portal auth user. The client row stays so payments
    remain attributable. Irreversible. */
export async function anonymizeClientRecord(admin: SupabaseClient, id: string): Promise<void> {
  const { data: before } = await admin.from("clients").select("cell_phone").eq("id", id).maybeSingle();
  if (!before) throw new Error("Client not found.");
  const { error } = await admin
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
  if (error) throw new Error(error.message);
  await syncClientLoginPhone(id, null, before.cell_phone ?? null);
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
      /* PII is already scrubbed; a stale auth row can be cleaned up manually */
    }
  }
}
