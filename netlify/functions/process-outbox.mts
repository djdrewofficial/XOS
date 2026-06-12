import type { Config } from "@netlify/functions";

/* Every 10 minutes: send queued emails (the pg_cron scheduled-email engine
   queues into email_log; this delivers them through Mailgun). */
export default async () => {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL;
  const res = await fetch(`${base}/api/cron/send-outbox`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log("send-outbox:", res.status, await res.text());
};

export const config: Config = {
  schedule: "*/10 * * * *",
};
