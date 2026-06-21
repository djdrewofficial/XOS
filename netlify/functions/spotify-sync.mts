import type { Config } from "@netlify/functions";

/* Hourly: reconcile every section that's live-synced to a Spotify playlist —
   adds new tracks, removes ones taken off the playlist (see /api/cron/spotify-sync). */
export default async () => {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL;
  const res = await fetch(`${base}/api/cron/spotify-sync`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log("spotify-sync:", res.status, await res.text());
};

export const config: Config = {
  schedule: "0 * * * *",
};
