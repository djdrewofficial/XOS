/* Account provisioning — create logins, send branded invites, reset passwords.
   Uses the service-role admin client (bypasses RLS) so it must stay SERVER-ONLY:
   never import this into a client component. Invites/resets use Supabase
   `generateLink` to mint the action link, then deliver it through Mailgun so the
   email matches the rest of XOS. */

import { createAdminClient } from "@/lib/supabase/admin";
import { sendBrandedEmail } from "@/lib/mailgun";
import { appUrl } from "@/lib/signing";

export type AccountType = "staff" | "client" | "event_guest";

type Admin = ReturnType<typeof createAdminClient>;

const SET_PASSWORD_URL = `${appUrl()}/auth/set-password`;
/* Client/guest invites deep-link into the Xpress Entertainment app so couples
   set their password in-app (works on a phone — the web URL may be localhost in
   dev / unreachable). Configurable via CLIENT_APP_REDIRECT. */
const CLIENT_SET_PASSWORD_URL = process.env.CLIENT_APP_REDIRECT || "xpressclient://auth/set-password";
const setPasswordUrlFor = (type: AccountType) => (type === "staff" ? SET_PASSWORD_URL : CLIENT_SET_PASSWORD_URL);

/** Find an existing auth user id by email (paged scan — fine at our scale). */
async function findAuthUserByEmail(admin: Admin, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Create the auth user if needed; return its id either way. New users are
    created email-confirmed with no password — they set one via the recovery link. */
async function ensureAuthUser(admin: Admin, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (data?.user) return data.user.id;
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) return existing;
  throw new Error(error?.message ?? "Could not create or locate the login.");
}

/** A recovery link that lands on /auth/set-password (used for both invite and reset). */
async function recoveryActionLink(admin: Admin, email: string, redirectTo: string = SET_PASSWORD_URL): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  const link = data?.properties?.action_link;
  if (error || !link) throw new Error(error?.message ?? "Could not generate the link.");
  return link;
}

function button(href: string, label: string): string {
  return `<div style="text-align:center;margin:26px 0;">
    <a href="${href}" style="display:inline-block;background:#4b328e;background:linear-gradient(110deg,#4b328e,#8b6fd6);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:10px;">${label}</a>
  </div>`;
}

type AppLinks = { ios?: string | null; android?: string | null; web?: string | null };

/** App-store buttons appended to client invites so they can download and log in. */
function appLinksHtml(links: AppLinks | null): string {
  if (!links) return "";
  const rows = [
    links.ios ? button(links.ios, "Download for iPhone") : "",
    links.android ? button(links.android, "Download for Android") : "",
    links.web && !links.ios && !links.android ? button(links.web, "Open the planner") : "",
  ].filter(Boolean);
  if (!rows.length) return "";
  return `<p style="font-size:13px;color:#4a4a52;line-height:1.6;margin:18px 0 4px;font-weight:600;">Get the Xpress app to plan your event:</p>${rows.join("")}`;
}

function inviteHtml(greeting: string, link: string, type: AccountType, appLinks: AppLinks | null = null): string {
  const what =
    type === "staff"
      ? "Your Xpress Entertainment team account is ready."
      : "Your event planning account is ready.";
  return `<p style="font-size:15px;color:#1d1d22;margin:0 0 10px;">${greeting}</p>
    <p style="font-size:14px;color:#4a4a52;line-height:1.6;margin:0 0 6px;">${what} Click below to set your password and sign in.</p>
    ${button(link, "Set My Password")}
    ${appLinksHtml(appLinks)}
    <p style="font-size:12px;color:#8a8a94;line-height:1.6;margin:8px 0 0;">This link expires in 24 hours. If you didn't expect this, you can ignore this email.</p>`;
}

function resetHtml(link: string): string {
  return `<p style="font-size:15px;color:#1d1d22;margin:0 0 10px;">Password reset</p>
    <p style="font-size:14px;color:#4a4a52;line-height:1.6;margin:0 0 6px;">We received a request to reset your XOS password. Click below to choose a new one.</p>
    ${button(link, "Reset My Password")}
    <p style="font-size:12px;color:#8a8a94;line-height:1.6;margin:8px 0 0;">This link expires in 24 hours. If you didn't request this, you can safely ignore this email.</p>`;
}

/* Code (OTP) reset — used by the mobile app so the whole reset stays in-app:
   the couple types this code into the app instead of following a deep link. */
function resetCodeHtml(code: string): string {
  return `<p style="font-size:15px;color:#1d1d22;margin:0 0 10px;">Password reset</p>
    <p style="font-size:14px;color:#4a4a52;line-height:1.6;margin:0 0 14px;">Enter this code in the Xpress Entertainment app to reset your password:</p>
    <div style="text-align:center;margin:6px 0 20px;">
      <span style="display:inline-block;font-size:34px;letter-spacing:12px;font-weight:800;color:#4b328e;background:#f4f1fb;border:1px solid #e4ddf7;border-radius:12px;padding:16px 22px 16px 34px;">${code}</span>
    </div>
    <p style="font-size:12px;color:#8a8a94;line-height:1.6;margin:8px 0 0;">This code expires in about an hour. If you didn't request this, you can safely ignore this email.</p>`;
}

/** Create/ensure a login for someone, link it in `accounts`, and email the invite. */
export async function sendAccountInvite(args: {
  type: AccountType;
  email: string | null | undefined;
  name?: string | null;
  employeeId?: string;
  clientId?: string;
  eventGuestId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const email = (args.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "No email on file — add one first." };

  const admin = createAdminClient();
  try {
    const userId = await ensureAuthUser(admin, email);

    const row: Record<string, unknown> = {
      auth_user_id: userId,
      account_type: args.type,
      email,
      updated_at: new Date().toISOString(),
    };
    if (args.type === "staff") row.employee_id = args.employeeId;
    if (args.type === "client") row.client_id = args.clientId;
    if (args.type === "event_guest") row.event_guest_id = args.eventGuestId;

    const { error: accErr } = await admin.from("accounts").upsert(row, { onConflict: "auth_user_id" });
    if (accErr) return { ok: false, error: accErr.message };

    // keep the legacy employees.auth_user_id link in sync
    if (args.type === "staff" && args.employeeId) {
      await admin.from("employees").update({ auth_user_id: userId }).eq("id", args.employeeId);
    }

    const link = await recoveryActionLink(admin, email, setPasswordUrlFor(args.type));
    const greeting = args.name ? `Hi ${args.name},` : "Hello,";

    // clients get app-download links alongside their login
    let appLinks: AppLinks | null = null;
    if (args.type === "client") {
      const { data: js } = await admin
        .from("journey_settings")
        .select("vibo_ios_url, vibo_android_url, vibo_web_url")
        .eq("id", true)
        .maybeSingle();
      if (js) appLinks = { ios: js.vibo_ios_url, android: js.vibo_android_url, web: js.vibo_web_url };
    }

    return await sendBrandedEmail({
      to: email,
      subject: args.type === "staff" ? "Your XOS account is ready" : "Your Xpress account — set your password & download the app",
      contentHtml: inviteHtml(greeting, link, args.type, appLinks),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Email a password-reset link to an existing login. */
export async function sendPasswordReset(
  email: string | null | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return { ok: false, error: "No email on file." };
  const admin = createAdminClient();
  try {
    const userId = await findAuthUserByEmail(admin, addr);
    if (!userId) return { ok: false, error: "No XOS login exists for that email yet — send an invite first." };
    const { data: acct } = await admin.from("accounts").select("account_type").eq("auth_user_id", userId).maybeSingle();
    const link = await recoveryActionLink(admin, addr, setPasswordUrlFor((acct?.account_type as AccountType) ?? "staff"));
    return await sendBrandedEmail({
      to: addr,
      subject: "Reset your XOS password",
      contentHtml: resetHtml(link),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Email a 6-digit password-reset CODE (not a link) to an existing login. The
    app verifies it with Supabase (verifyOtp type "recovery") and sets the new
    password in-app. `generateLink` returns the OTP alongside the link — we send
    only the code, branded via Mailgun. */
export async function sendPasswordResetCode(
  email: string | null | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return { ok: false, error: "No email on file." };
  const admin = createAdminClient();
  try {
    const userId = await findAuthUserByEmail(admin, addr);
    if (!userId) return { ok: false, error: "No XOS login exists for that email yet — send an invite first." };
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: addr });
    const code = data?.properties?.email_otp;
    if (error || !code) throw new Error(error?.message ?? "Could not generate a reset code.");
    return await sendBrandedEmail({
      to: addr,
      subject: "Your XOS password reset code",
      contentHtml: resetCodeHtml(code),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
