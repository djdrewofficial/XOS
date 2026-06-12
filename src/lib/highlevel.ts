import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/* ============ HighLevel (LeadConnector API v2) config ============
   Set in .env.local (and Netlify env for prod):
     HIGHLEVEL_PI_TOKEN    — sub-account Settings → Private Integrations
                             (scopes: Contacts read/write, Conversations/Messages write)
     HIGHLEVEL_LOCATION_ID — the sub-account id
   SMS goes through a GHL contact, so sending is: upsert contact by phone →
   POST the message. Replies thread into the GHL Conversations inbox. */

const API_BASE = "https://services.leadconnectorhq.com";

function highlevelConfig() {
  return {
    token: process.env.HIGHLEVEL_PI_TOKEN,
    locationId: process.env.HIGHLEVEL_LOCATION_ID,
  };
}

export function isHighLevelConfigured(): boolean {
  const { token, locationId } = highlevelConfig();
  return !!(token && locationId);
}

/** US-centric E.164 normalization — GHL matches/creates contacts by phone. */
export function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return `+${trimmed.replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

async function hlFetch(
  path: string,
  version: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const { token } = highlevelConfig();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: version,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` };
    return { ok: true, data: text ? JSON.parse(text) : {} };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

/** Find-or-create the GHL contact for this phone number. */
async function upsertContact(opts: {
  phone: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  const { locationId } = highlevelConfig();
  const result = await hlFetch("/contacts/upsert", "2021-07-28", {
    locationId,
    phone: opts.phone,
    ...(opts.firstName ? { firstName: opts.firstName } : {}),
    ...(opts.lastName ? { lastName: opts.lastName } : {}),
    ...(opts.email ? { email: opts.email } : {}),
  });
  if (!result.ok) return result;
  const contact = result.data.contact as { id?: string } | undefined;
  if (!contact?.id) return { ok: false, error: "upsert returned no contact id" };
  return { ok: true, contactId: contact.id };
}

/** Low-level SMS send to an existing GHL contact. */
async function sendSms(
  contactId: string,
  message: string
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const result = await hlFetch("/conversations/messages", "2021-04-15", {
    type: "SMS",
    contactId,
    message,
  });
  if (!result.ok) return result;
  const id = (result.data.messageId ?? result.data.msg ?? null) as string | null;
  return { ok: true, messageId: typeof id === "string" ? id : null };
}

/** Drains queued rows from sms_log through HighLevel.
    Pass a service-role client when running without a user session (cron, sign flow). */
export async function processSmsOutbox(
  client?: SupabaseClient
): Promise<{ sent: number; failed: number; skipped: string | null }> {
  if (!isHighLevelConfigured()) {
    return {
      sent: 0,
      failed: 0,
      skipped: "HighLevel not configured (set HIGHLEVEL_PI_TOKEN and HIGHLEVEL_LOCATION_ID)",
    };
  }

  const supabase = client ?? (await createClient());
  const { data: queued } = await supabase
    .from("sms_log")
    .select("*, client:clients(first_name, last_name, email)")
    .eq("status", "queued")
    .order("created_at")
    .limit(50);

  let sent = 0;
  let failed = 0;

  for (const msg of queued ?? []) {
    const fail = async (error: string) => {
      await supabase.from("sms_log").update({ status: "failed", error }).eq("id", msg.id);
      failed++;
    };

    const phone = toE164(msg.to_number);
    if (!phone) {
      await fail(`invalid phone number: ${msg.to_number}`);
      continue;
    }

    const cl = msg.client as { first_name?: string; last_name?: string; email?: string } | null;
    const contact = await upsertContact({
      phone,
      firstName: cl?.first_name,
      lastName: cl?.last_name,
      email: cl?.email,
    });
    if (!contact.ok) {
      await fail(`contact upsert: ${contact.error}`);
      continue;
    }

    const result = await sendSms(contact.contactId, msg.body);
    if (result.ok) {
      await supabase
        .from("sms_log")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          hl_contact_id: contact.contactId,
          provider_message_id: result.messageId,
          error: null,
        })
        .eq("id", msg.id);
      sent++;
    } else {
      await fail(result.error);
    }
  }

  return { sent, failed, skipped: null };
}
