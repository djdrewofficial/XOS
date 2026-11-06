import { appleTeamId, CLIENT_IOS_BUNDLE_ID } from "@/lib/clientApp";

/* Universal Links for /j/* and webcredentials so the iOS app can use
   passkeys whose relying party is xos.xpressdjs.com.
   Apple fetches this with no cookies. */

export const dynamic = "force-dynamic";

export function GET() {
  const appId = `${appleTeamId(process.env.APPLE_TEAM_ID)}.${CLIENT_IOS_BUNDLE_ID}`;
  const body = {
    applinks: {
      apps: [] as string[],
      details: [
        {
          appIDs: [appId],
          components: [{ "/": "/j/*", comment: "Event join links" }],
        },
      ],
    },
    webcredentials: {
      apps: [appId],
    },
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
