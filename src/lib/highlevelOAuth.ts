import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl } from "@/lib/signing";

/* ============ HighLevel Marketplace-App OAuth ============
   Separate from the Private Integration Token (lib/highlevel.ts). This is only
   used for calls that require a GHL Conversation Provider — namely logging an
   outbound email into a conversation WITHOUT GHL re-sending it, which must be
   authenticated with the OAuth access token of the Marketplace App that owns the
   provider. Everything else in XOS keeps using the PIT.

   Setup (one-time, in the GHL Marketplace developer portal):
     1. Create a Marketplace App (distribution can be "Sub-Account"/private).
     2. Add OAuth scopes: contacts.write, conversations.readonly,
        conversations.write, conversations/message.write.
     3. Add a Conversation Provider (type Email) -> copy its Provider ID.
     4. Set the Redirect URL to  <APP_URL>/api/comms-oauth/callback.
   Then set env: GHL_MARKETPLACE_CLIENT_ID, GHL_MARKETPLACE_CLIENT_SECRET,
   HIGHLEVEL_CONVERSATION_PROVIDER_ID — and click Connect in Settings -> Email. */

const AUTHORIZE_BASE = "https://marketplace.gohighlevel.com/oauth/chooselocation";
const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const API_BASE = "https://services.leadconnectorhq.com";

// Minimum scopes for the outbound-threading flow (contact upsert + conversation
// lookup + posting the logged outbound message).
const SCOPES = [
  "contacts.write",
  "contacts.readonly",
  "conversations.readonly",
  "conversations.write",
  "conversations/message.write",
];

export function marketplaceOAuthConfig() {
  return {
    clientId: process.env.GHL_MARKETPLACE_CLIENT_ID,
    clientSecret: process.env.GHL_MARKETPLACE_CLIENT_SECRET,
    providerId: process.env.HIGHLEVEL_CONVERSATION_PROVIDER_ID,
  };
}

/** App credentials present — the OAuth connect flow can run. */
export function isMarketplaceOAuthConfigured(): boolean {
  const { clientId, clientSecret } = marketplaceOAuthConfig();
  return !!(clientId && clientSecret);
}

/** Everything needed to log outbound email into GHL is present (creds + provider). */
export function isThreadingConfigured(): boolean {
  const { clientId, clientSecret, providerId } = marketplaceOAuthConfig();
  return !!(clientId && clientSecret && providerId);
}

export function oauthRedirectUri(): string {
  // Path avoids the word "highlevel" — GHL's white-label validation rejects
  // redirect URLs (and app assets) that reference it.
  return `${appUrl()}/api/comms-oauth/callback`;
}

/** The GHL consent URL to send an admin to when connecting the app. */
export function buildAuthorizeUrl(state: string): string {
  const { clientId } = marketplaceOAuthConfig();
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: oauthRedirectUri(),
    client_id: clientId ?? "",
    scope: SCOPES.join(" "),
  });
  // state carries CSRF protection; GHL echoes it back to the callback.
  params.set("state", state);
  return `${AUTHORIZE_BASE}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scope?: string;
  locationId?: string;
  companyId?: string;
  userId?: string;
};

async function postToken(form: Record<string, string>): Promise<{ ok: true; data: TokenResponse } | { ok: false; error: string }> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` };
    return { ok: true, data: JSON.parse(text) as TokenResponse };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

async function storeToken(admin: SupabaseClient, t: TokenResponse): Promise<string | null> {
  const locationId = t.locationId ?? null;
  if (!locationId) return null;
  const expiresAt = new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString();
  await admin.from("hl_oauth_tokens").upsert(
    {
      location_id: locationId,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: expiresAt,
      scope: t.scope ?? null,
      company_id: t.companyId ?? null,
      hl_user_id: t.userId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "location_id" },
  );
  return locationId;
}

/** Exchange the authorization code from the callback for tokens and store them. */
export async function exchangeCodeForToken(
  admin: SupabaseClient,
  code: string,
): Promise<{ ok: true; locationId: string } | { ok: false; error: string }> {
  const { clientId, clientSecret } = marketplaceOAuthConfig();
  if (!clientId || !clientSecret) return { ok: false, error: "Marketplace app credentials not set" };
  const result = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    user_type: "Location",
    redirect_uri: oauthRedirectUri(),
  });
  if (!result.ok) return result;
  const locationId = await storeToken(admin, result.data);
  if (!locationId) return { ok: false, error: "Token response had no locationId (install on a sub-account, not the agency)" };
  return { ok: true, locationId };
}

/** Whether an OAuth connection exists for the tenant. */
export async function isHighLevelOAuthConnected(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from("hl_oauth_tokens").select("location_id").limit(1).maybeSingle();
  return !!data;
}

/** A valid (refreshed if needed) access token for the connected location. */
async function getValidAccessToken(admin: SupabaseClient): Promise<{ token: string; locationId: string } | null> {
  const { data: row } = await admin
    .from("hl_oauth_tokens")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return null;

  // Refresh a minute before expiry so an in-flight call never uses a dead token.
  const expiresAt = new Date(row.expires_at as string).getTime();
  if (Date.now() < expiresAt - 60_000) {
    return { token: row.access_token as string, locationId: row.location_id as string };
  }

  const { clientId, clientSecret } = marketplaceOAuthConfig();
  if (!clientId || !clientSecret) return null;
  const refreshed = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: row.refresh_token as string,
    user_type: "Location",
  });
  if (!refreshed.ok) {
    console.warn("HighLevel OAuth refresh failed:", refreshed.error);
    return null;
  }
  await storeToken(admin, refreshed.data);
  return { token: refreshed.data.access_token, locationId: refreshed.data.locationId ?? (row.location_id as string) };
}

async function oauthFetch(
  token: string,
  path: string,
  version: string,
  body?: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: version,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` };
    return { ok: true, data: text ? JSON.parse(text) : {} };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

/** Logs an already-delivered (via Mailgun) outbound email into the recipient's
    GHL conversation WITHOUT GHL re-sending it, using the Marketplace App's OAuth
    token + Conversation Provider. Best-effort: the caller has already delivered
    the mail, so every failure is returned (never thrown) and the send is
    unaffected. Returns null-ish {ok:false} silently when not connected/configured. */
export async function threadOutboundEmailViaOAuth(
  admin: SupabaseClient,
  opts: {
    toEmail: string;
    fromName?: string | null;
    fromEmail?: string | null;
    subject: string;
    html: string;
    attachmentUrls?: string[];
  },
): Promise<{ ok: boolean; messageId?: string | null; error?: string }> {
  const { providerId } = marketplaceOAuthConfig();
  if (!providerId) return { ok: false, error: "no conversation provider configured" };
  const auth = await getValidAccessToken(admin);
  if (!auth) return { ok: false, error: "HighLevel app not connected" };

  // 1. Find-or-create the contact by email.
  const upsert = await oauthFetch(auth.token, "/contacts/upsert", "2021-07-28", {
    locationId: auth.locationId,
    email: opts.toEmail,
  });
  if (!upsert.ok) return { ok: false, error: `contact upsert: ${upsert.error}` };
  const contactId = (upsert.data.contact as { id?: string } | undefined)?.id;
  if (!contactId) return { ok: false, error: "contact upsert returned no id" };

  // 2. Reuse the contact's existing conversation when there is one.
  let conversationId: string | null = null;
  const search = await oauthFetch(
    auth.token,
    `/conversations/search?locationId=${auth.locationId}&contactId=${contactId}`,
    "2021-04-15",
  );
  if (search.ok) {
    const convs = (search.data.conversations ?? []) as { id?: string }[];
    conversationId = convs[0]?.id ?? null;
  }

  // 3. Log the outbound email into the conversation (does NOT send it).
  const payload: Record<string, unknown> = {
    type: "Email",
    conversationProviderId: providerId,
    contactId,
    ...(conversationId ? { conversationId } : {}),
    subject: opts.subject || "Message from Xpress Entertainment",
    html: opts.html,
    emailTo: [opts.toEmail],
    ...(opts.fromEmail
      ? { emailFrom: opts.fromName ? `${opts.fromName} <${opts.fromEmail}>` : opts.fromEmail }
      : {}),
    ...(opts.attachmentUrls?.length ? { attachments: opts.attachmentUrls } : {}),
  };
  const result = await oauthFetch(auth.token, "/conversations/messages/outbound", "2021-04-15", payload);
  if (!result.ok) {
    console.warn("HighLevel thread-log (outbound message) failed:", result.error);
    return { ok: false, error: result.error };
  }
  const id = (result.data.messageId ?? result.data.msg ?? null) as string | null;
  return { ok: true, messageId: typeof id === "string" ? id : null };
}
