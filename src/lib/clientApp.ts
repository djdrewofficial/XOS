/** iOS bundle id from xpress-client app.json (expo.ios.bundleIdentifier). */
export const CLIENT_IOS_BUNDLE_ID = "com.xpressentertainment.client";

/** URL scheme from xpress-client app.json (expo.scheme). */
export const CLIENT_APP_SCHEME = "xpressclient";

/** Apple Team ID Drew confirmed for this app. Env APPLE_TEAM_ID overrides it. */
export const APPLE_TEAM_ID = "VH9Z63JB8L";

export function appleTeamId(envValue: string | null | undefined): string {
  const fromEnv = envValue?.trim() ?? "";
  return fromEnv || APPLE_TEAM_ID;
}
