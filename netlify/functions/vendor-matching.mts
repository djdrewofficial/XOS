import type { Config } from "@netlify/functions";

/* Once a day: GPT-match couple-added vendors against the directory and build the
   review queue. Staff approve/dismiss in /vendors/review. */
export default async () => {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL;
  const res = await fetch(`${base}/api/cron/vendor-matching`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log("vendor-matching:", res.status, await res.text());
};

export const config: Config = {
  schedule: "30 11 * * *",
};
