import type { Config } from "@netlify/functions";

/* Daily at 13:05 UTC (~9am ET): charge each armed event's due scheduled payment
   against its vaulted PayPal method. */
export default async () => {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL;
  const res = await fetch(`${base}/api/cron/autopay`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log("autopay:", res.status, await res.text());
};

export const config: Config = {
  schedule: "5 13 * * *",
};
