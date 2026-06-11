import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/* ============ Mailgun config ============
   Set in .env.local:
     MAILGUN_API_KEY     — Sending → Domain settings → API keys
     MAILGUN_DOMAIN      — e.g. xpressdjs.com (or mg.xpressdjs.com)
     MAILGUN_REGION      — "us" (default) or "eu"
     MAIL_FROM           — fallback From when a message has no stored sender
     MAILGUN_SIGNING_KEY — webhook signing key (for delivery tracking)
*/
function mailgunConfig() {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const region = (process.env.MAILGUN_REGION ?? "us").toLowerCase();
  const base = region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  return { apiKey, domain, base };
}

export function isMailgunConfigured(): boolean {
  const { apiKey, domain } = mailgunConfig();
  return !!(apiKey && domain);
}

function fmtSender(name: string | null, email: string): string {
  return name ? `${name} <${email}>` : email;
}

/** Low-level send. Returns Mailgun's message id on success. */
async function mailgunSend(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
  tags?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { apiKey, domain, base } = mailgunConfig();
  if (!apiKey || !domain) return { ok: false, error: "Mailgun not configured" };

  const form = new FormData();
  form.append("from", opts.from);
  form.append("to", opts.to);
  form.append("subject", opts.subject);
  form.append("html", opts.html || "<p>(empty)</p>");
  if (opts.replyTo) form.append("h:Reply-To", opts.replyTo);
  for (const tag of opts.tags ?? []) form.append("o:tag", tag);

  try {
    const res = await fetch(`${base}/v3/${domain}/messages`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`api:${apiKey}`).toString("base64") },
      body: form,
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      // Mailgun returns the id wrapped in <>; strip for clean correlation with webhooks.
      const id = (data.id ?? "").replace(/^<|>$/g, "");
      return { ok: true, id };
    }
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

/** Drains queued rows from the outbox through Mailgun, using each row's stored sender identity.
    Pass a service-role client when running without a user session (cron route). */
export async function processOutbox(
  client?: SupabaseClient
): Promise<{ sent: number; failed: number; skipped: string | null }> {
  const { domain } = mailgunConfig();
  if (!isMailgunConfigured()) {
    return { sent: 0, failed: 0, skipped: "Mailgun not configured (set MAILGUN_API_KEY and MAILGUN_DOMAIN in .env.local)" };
  }

  const fallbackFrom = process.env.MAIL_FROM ?? `Xpress Entertainment <events@${domain}>`;
  const supabase = client ?? (await createClient());
  const { data: queued } = await supabase
    .from("email_log")
    .select("*")
    .eq("status", "queued")
    .order("created_at")
    .limit(50);

  let sent = 0;
  let failed = 0;

  for (const msg of queued ?? []) {
    const from = msg.from_address ? fmtSender(msg.from_name, msg.from_address) : fallbackFrom;
    const result = await mailgunSend({
      from,
      to: msg.to_address,
      subject: msg.subject,
      html: msg.body_html,
      replyTo: msg.reply_to,
      tags: ["xos", msg.event_id ? "event" : "manual"],
    });

    if (result.ok) {
      await supabase
        .from("email_log")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: result.id || null,
          error: null,
        })
        .eq("id", msg.id);
      sent++;
    } else {
      await supabase.from("email_log").update({ status: "failed", error: result.error }).eq("id", msg.id);
      failed++;
    }
  }

  return { sent, failed, skipped: null };
}

/** Sends a one-off test email and records it in the outbox/log. */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  const { domain } = mailgunConfig();
  if (!isMailgunConfigured()) return { ok: false, error: "Mailgun not configured" };

  const supabase = await createClient();
  const { data: cs } = await supabase
    .from("company_settings")
    .select("from_name, from_email, reply_to")
    .eq("id", true)
    .maybeSingle();

  const fromName = cs?.from_name ?? "Xpress Entertainment";
  const fromEmail = cs?.from_email ?? `events@${domain}`;
  const subject = "XOS test email";
  const html = `<p>This is a test email from XOS, sent through Mailgun (<strong>${domain}</strong>).</p>
    <p>If you're reading this, sending is configured correctly.</p>`;

  const result = await mailgunSend({
    from: fmtSender(fromName, fromEmail),
    to,
    subject,
    html,
    replyTo: cs?.reply_to ?? fromEmail,
    tags: ["xos", "test"],
  });

  await supabase.from("email_log").insert({
    to_address: to,
    from_name: fromName,
    from_address: fromEmail,
    reply_to: cs?.reply_to ?? fromEmail,
    subject,
    body_html: html,
    status: result.ok ? "sent" : "failed",
    sent_at: result.ok ? new Date().toISOString() : null,
    provider_message_id: result.ok ? result.id || null : null,
    error: result.ok ? null : result.error,
  });

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
