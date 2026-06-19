import type { Config } from "@netlify/functions";

/* Once a day (~7am ET): build the GPT morning briefing and email the office. */
export default async () => {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL;
  const res = await fetch(`${base}/api/cron/morning-briefing`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log("morning-briefing:", res.status, await res.text());
};

export const config: Config = {
  // 11:00 UTC ≈ 7:00am Eastern (EDT). Adjust if you want a different time.
  schedule: "0 11 * * *",
};
