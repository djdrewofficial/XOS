import type { Config } from "@netlify/functions";

/* Hourly: run any AI daily task that's due (configured in Settings → AI
   Assistant). The route reads each task's enabled flag + send hour (company
   timezone) and runs it once per day. */
export default async () => {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL;
  const res = await fetch(`${base}/api/cron/ai-tasks`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log("ai-tasks:", res.status, await res.text());
};

export const config: Config = {
  schedule: "0 * * * *",
};
