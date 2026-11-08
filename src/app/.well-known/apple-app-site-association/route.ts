import { CLIENT_IOS_BUNDLE_ID } from "@/lib/clientApp";

/* Universal Links for https://xos.xpressdjs.com/j/*
   Apple fetches this with no cookies. Team id is APPLE_TEAM_ID (not in the
   xpress-client repo). Until that env var is set, details is empty and iOS
   will not open the app from these links. */

export const dynamic = "force-dynamic";

export function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim() ?? "";
  const appId = teamId ? `${teamId}.${CLIENT_IOS_BUNDLE_ID}` : "";
  const body = {
    applinks: {
      apps: [] as string[],
      details: appId
        ? [
            {
              appIDs: [appId],
              components: [{ "/": "/j/*", comment: "Event join links" }],
            },
          ]
        : [],
    },
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
