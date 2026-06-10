import { createClient } from "@/lib/supabase/server";

// Sends queued email_log rows through Mailgun.
// Configure in .env.local: MAILGUN_API_KEY, MAILGUN_DOMAIN, MAIL_FROM.
// Production path (per spec): move this into a Supabase Edge Function on a cron
// so sending doesn't depend on the web app being open.
export async function processOutbox(): Promise<{ sent: number; failed: number; skipped: string | null }> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.MAIL_FROM ?? `Xpress Entertainment <noreply@${domain}>`;

  if (!apiKey || !domain) {
    return { sent: 0, failed: 0, skipped: "Mailgun not configured (set MAILGUN_API_KEY and MAILGUN_DOMAIN in .env.local)" };
  }

  const supabase = await createClient();
  const { data: queued } = await supabase
    .from("email_log")
    .select("*")
    .eq("status", "queued")
    .limit(25);

  let sent = 0;
  let failed = 0;

  for (const msg of queued ?? []) {
    const form = new FormData();
    form.append("from", from);
    form.append("to", msg.to_address);
    form.append("subject", msg.subject);
    form.append("html", msg.body_html || "<p>(empty)</p>");

    try {
      const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`api:${apiKey}`).toString("base64"),
        },
        body: form,
      });
      if (res.ok) {
        await supabase
          .from("email_log")
          .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
          .eq("id", msg.id);
        sent++;
      } else {
        const text = await res.text();
        await supabase
          .from("email_log")
          .update({ status: "failed", error: `${res.status}: ${text.slice(0, 300)}` })
          .eq("id", msg.id);
        failed++;
      }
    } catch (err) {
      await supabase
        .from("email_log")
        .update({ status: "failed", error: String(err).slice(0, 300) })
        .eq("id", msg.id);
      failed++;
    }
  }

  return { sent, failed, skipped: null };
}
