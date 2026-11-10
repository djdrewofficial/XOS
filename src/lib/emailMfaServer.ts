import { randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { isOwnerEmail } from "@/lib/permissions";
import { permCacheSecret } from "@/lib/permSnapshot";
import { sendBrandedEmail } from "@/lib/mailgun";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { LAST_METHOD_MESSAGE, factorBucket, isLastMethodError, removalWouldLeaveNone } from "@/lib/passkey";
import { loadAuthMethods, sessionIsStrong } from "@/lib/strongAuthServer";
import {
  EMAIL_MFA_LOG_HTML,
  EMAIL_MFA_SUBJECT,
  EMAIL_MFA_TTL_MS,
  emailMfaBeginMessage,
  emailMfaConsumeMessage,
  emailMfaContentHtml,
  generateEmailMfaCode,
  hashEmailMfaCode,
  isEmailMfaPurpose,
  isMissingEmailMfaSchema,
  scrubEmailMfaSecret,
  type EmailMfaPurpose,
} from "@/lib/emailMfa";
import {
  MFA_EMAIL_COOKIE,
  MFA_EMAIL_STEPUP_TTL_SEC,
  readMfaEmailStepUp,
  sessionIdFromAccessToken,
  signMfaEmailStepUp,
} from "@/lib/mfaStepUpCookie";

export type EmailMfaResult = { ok: true } | { ok: false; error: string };

type StaffSession = {
  supabase: SupabaseClient;
  userId: string;
  email: string;
  emailFlag: boolean;
  sessionId: string;
};

const MISSING = "Email codes need a one-time database setup before they can be used.";

function pepper(): string | undefined {
  return permCacheSecret();
}

/** `bearer` is the XOS Staff app's access token (mobile routes have no cookies). */
async function staffSession(bearer?: string): Promise<{ ok: true; ctx: StaffSession } | { ok: false; error: string }> {
  let supabase: SupabaseClient;
  let user: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null;
  let sessionId: string | null;
  if (bearer) {
    supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(bearer);
    if (error || !data.user?.email) return { ok: false, error: "You need to be signed in again." };
    user = data.user;
    sessionId = sessionIdFromAccessToken(bearer);
    if (!sessionId) return { ok: false, error: "You need to be signed in again." };
  } else {
    supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email) return { ok: false, error: "You need to be signed in again." };
    user = data.user;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    sessionId = sessionIdFromAccessToken(session?.access_token);
    if (!sessionId || session?.user.id !== user.id) return { ok: false, error: "You need to be signed in again." };
  }
  if (!user.email) return { ok: false, error: "You need to be signed in again." };

  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (empErr) return { ok: false, error: "Couldn't confirm this staff login. Try again." };
  if (!emp && !isOwnerEmail(user.email)) return { ok: false, error: "Email codes are for staff sign-in." };

  return {
    ok: true,
    ctx: {
      supabase,
      userId: user.id,
      email: user.email.trim().toLowerCase(),
      emailFlag: user.app_metadata?.email_mfa === true,
      sessionId,
    },
  };
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

async function writeStepUpCookie(userId: string, sessionId: string): Promise<boolean> {
  const secret = pepper();
  if (!secret) return false;
  const value = await signMfaEmailStepUp(
    { uid: userId, sid: sessionId, exp: Math.floor(Date.now() / 1000) + MFA_EMAIL_STEPUP_TTL_SEC },
    secret,
  );
  const jar = await cookies();
  jar.set(MFA_EMAIL_COOKIE, value, cookieOptions(MFA_EMAIL_STEPUP_TTL_SEC));
  return true;
}

export async function clearEmailStepUpCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(MFA_EMAIL_COOKIE, "", cookieOptions(0));
}

export async function currentEmailStepUp(userId: string, sessionId: string | null): Promise<boolean> {
  const jar = await cookies();
  return readMfaEmailStepUp(jar.get(MFA_EMAIL_COOKIE)?.value, pepper(), userId, sessionId);
}

async function markEmailFactor(userId: string, email: string): Promise<EmailMfaResult> {
  const admin = createAdminClient();
  const { error: rowErr } = await admin.from("staff_email_mfa").upsert(
    { user_id: userId, email, verified_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (rowErr) {
    return { ok: false, error: isMissingEmailMfaSchema(rowErr.message) ? MISSING : "Couldn't save email verification." };
  }
  const { data: existing, error: readErr } = await admin.auth.admin.getUserById(userId);
  if (readErr) return { ok: false, error: "Couldn't finish email verification. Try again." };
  const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...(existing.user?.app_metadata ?? {}), email_mfa: true },
  });
  if (metaErr) {
    await admin.rpc("xos_email_mfa_clear", { p_user_id: userId });
    return { ok: false, error: "Couldn't finish email verification. Try again." };
  }
  return { ok: true };
}

async function consume(ctx: StaffSession, purpose: EmailMfaPurpose, code: string): Promise<EmailMfaResult> {
  const secret = pepper();
  if (!secret) return { ok: false, error: "Email codes aren't available right now." };
  let codeHash: string;
  try {
    codeHash = hashEmailMfaCode(code, secret);
  } catch {
    return { ok: false, error: "Enter the 6-digit code from the email." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("xos_email_mfa_consume", {
    p_user_id: ctx.userId,
    p_session_id: ctx.sessionId,
    p_purpose: purpose,
    p_code_hash: codeHash,
  });
  if (error) return { ok: false, error: isMissingEmailMfaSchema(error.message) ? MISSING : "Couldn't check that code. Try again." };
  const status = typeof data === "object" && data && "status" in data ? String((data as { status: unknown }).status) : "";
  if (status !== "ok") return { ok: false, error: emailMfaConsumeMessage(status) };
  return { ok: true };
}

export async function sendEmailMfaCodeForSession(purpose: EmailMfaPurpose, bearer?: string): Promise<EmailMfaResult> {
  if (!isEmailMfaPurpose(purpose)) return { ok: false, error: "Couldn't send a verification code." };
  const session = await staffSession(bearer);
  if (!session.ok) return session;
  const { ctx } = session;
  const secret = pepper();
  if (!secret) return { ok: false, error: "Email codes aren't available right now." };

  const admin = createAdminClient();
  if (purpose === "signin") {
    const { data: factor, error: factorErr } = await admin
      .from("staff_email_mfa")
      .select("user_id")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (factorErr) return { ok: false, error: isMissingEmailMfaSchema(factorErr.message) ? MISSING : "Couldn't send a verification code." };
    if (!factor) return { ok: false, error: "Set up email codes in My Account → Security first." };
  }

  const code = generateEmailMfaCode((max) => randomInt(max));
  if (EMAIL_MFA_LOG_HTML.includes(code) || EMAIL_MFA_SUBJECT.includes(code)) {
    return { ok: false, error: "Couldn't send a verification code." };
  }
  const codeHash = hashEmailMfaCode(code, secret);
  const { data, error } = await admin.rpc("xos_email_mfa_begin", {
    p_user_id: ctx.userId,
    p_session_id: ctx.sessionId,
    p_purpose: purpose,
    p_code_hash: codeHash,
    p_expires_at: new Date(Date.now() + EMAIL_MFA_TTL_MS).toISOString(),
  });
  if (error) return { ok: false, error: isMissingEmailMfaSchema(error.message) ? MISSING : "Couldn't send a verification code." };
  const status = typeof data === "object" && data && "status" in data ? String((data as { status: unknown }).status) : "";
  if (status !== "ok") return { ok: false, error: emailMfaBeginMessage(status) };

  const sent = await sendBrandedEmail({
    to: ctx.email,
    subject: EMAIL_MFA_SUBJECT,
    contentHtml: emailMfaContentHtml(code),
    loggedBodyHtml: EMAIL_MFA_LOG_HTML,
    supabase: ctx.supabase,
  });
  if (!sent.ok) {
    await admin
      .from("staff_email_mfa_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", ctx.userId)
      .eq("session_id", ctx.sessionId)
      .eq("purpose", purpose)
      .is("consumed_at", null);
    return { ok: false, error: scrubEmailMfaSecret(sent.error ?? "Couldn't send the verification email.", code) };
  }
  return { ok: true };
}

/** With `bearer` (the staff app) there is no cookie to stamp: the app keeps
    its own proof bound to this session id, the same rule the cookie follows. */
export async function verifyEmailMfaCodeForSession(purpose: EmailMfaPurpose, code: string, bearer?: string): Promise<EmailMfaResult> {
  if (!isEmailMfaPurpose(purpose)) return { ok: false, error: "That code didn't work." };
  const session = await staffSession(bearer);
  if (!session.ok) return session;
  const { ctx } = session;
  const checked = await consume(ctx, purpose, code);
  if (!checked.ok) return checked;

  if (purpose === "enroll") {
    const saved = await markEmailFactor(ctx.userId, ctx.email);
    if (!saved.ok) return saved;
  } else {
    const admin = createAdminClient();
    const { data: updated, error } = await admin
      .from("staff_email_mfa")
      .update({ email: ctx.email, verified_at: new Date().toISOString() })
      .eq("user_id", ctx.userId)
      .select("user_id");
    if (error || !updated?.length) return { ok: false, error: "Set up email codes in My Account → Security first." };
  }

  if (bearer) return { ok: true };
  const stamped = await writeStepUpCookie(ctx.userId, ctx.sessionId);
  if (!stamped) return { ok: false, error: "Email codes aren't available right now." };
  return { ok: true };
}

export async function emailFactorStatus(): Promise<{ ready: boolean; enrolled: boolean; email: string | null }> {
  const session = await staffSession();
  if (!session.ok) return { ready: false, enrolled: false, email: null };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("staff_email_mfa")
      .select("user_id")
      .eq("user_id", session.ctx.userId)
      .maybeSingle();
    if (error) return { ready: !isMissingEmailMfaSchema(error.message), enrolled: false, email: null };
    return { ready: true, enrolled: Boolean(data), email: session.ctx.email };
  } catch {
    return { ready: false, enrolled: false, email: null };
  }
}

export async function disableEmailMfaForSession(): Promise<EmailMfaResult> {
  const session = await staffSession();
  if (!session.ok) return session;
  const { ctx } = session;
  const satisfied = await sessionIsStrong({ supabase: ctx.supabase, userId: ctx.userId, sessionId: ctx.sessionId });
  if (!satisfied) return { ok: false, error: "Verify a sign-in code or use your passkey first, then turn this off." };
  const methods = await loadAuthMethods({
    supabase: ctx.supabase,
    admin: createAdminClient(),
    userId: ctx.userId,
    emailFlag: ctx.emailFlag,
  });
  if (!methods.ok) return { ok: false, error: methods.error };
  if (removalWouldLeaveNone(methods.methods, "email")) return { ok: false, error: LAST_METHOD_MESSAGE };

  const admin = createAdminClient();
  const { data: existing, error: readErr } = await admin.auth.admin.getUserById(ctx.userId);
  if (readErr) return { ok: false, error: "Couldn't turn off email codes. Try again." };
  const meta = { ...(existing.user?.app_metadata ?? {}) };
  const { error: offErr } = await admin.auth.admin.updateUserById(ctx.userId, {
    app_metadata: { ...meta, email_mfa: false },
  });
  if (offErr) return { ok: false, error: "Couldn't turn off email codes. Try again." };
  const { error } = await admin.rpc("xos_email_mfa_clear", { p_user_id: ctx.userId });
  if (error) {
    await admin.auth.admin.updateUserById(ctx.userId, { app_metadata: { ...meta, email_mfa: true } });
    if (isLastMethodError(error.message)) return { ok: false, error: LAST_METHOD_MESSAGE };
    return { ok: false, error: isMissingEmailMfaSchema(error.message) ? MISSING : "Couldn't turn off email codes." };
  }
  await clearEmailStepUpCookie();
  return { ok: true };
}

/** Drop a Supabase factor after a fresh email code when this session is still aal1.
    The admin API ends the user's other sessions. Caller must already have confirmed
    the factor id belongs to this user. */
export async function deleteSupabaseFactorAfterEmailCode(factorId: string, code: string): Promise<EmailMfaResult> {
  if (!/^[0-9a-f-]{36}$/i.test(factorId)) return { ok: false, error: "That verification method isn't on this account." };
  const session = await staffSession();
  if (!session.ok) return session;
  const { ctx } = session;
  const { data: factors, error: listErr } = await ctx.supabase.auth.mfa.listFactors();
  if (listErr) return { ok: false, error: listErr.message };
  const mine = (factors?.all ?? []).find((factor: { id: string; status: string; factor_type: string }) => factor.id === factorId && factor.status === "verified");
  if (!mine) return { ok: false, error: "That verification method isn't on this account." };
  const methods = await loadAuthMethods({
    supabase: ctx.supabase,
    admin: createAdminClient(),
    userId: ctx.userId,
    emailFlag: ctx.emailFlag,
  });
  if (!methods.ok) return { ok: false, error: methods.error };
  if (removalWouldLeaveNone(methods.methods, factorBucket(mine.factor_type))) return { ok: false, error: LAST_METHOD_MESSAGE };

  const checked = await consume(ctx, "signin", code);
  if (!checked.ok) return checked;
  const stamped = await writeStepUpCookie(ctx.userId, ctx.sessionId);
  if (!stamped) return { ok: false, error: "Email codes aren't available right now." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.mfa.deleteFactor({ id: factorId, userId: ctx.userId });
  if (error) return { ok: false, error: isLastMethodError(error.message) ? LAST_METHOD_MESSAGE : error.message };
  return { ok: true };
}

/** Turn off an authenticator or text factor without leaving the account with
    neither a passkey nor a second factor. An aal2 session uses the normal
    unenroll. Otherwise the admin API removes it after this session has already
    verified a code or a passkey. */
export async function unenrollVerifiedFactorForSession(factorId: string): Promise<EmailMfaResult> {
  if (!/^[0-9a-f-]{36}$/i.test(factorId)) return { ok: false, error: "That verification method isn't on this account." };
  const session = await staffSession();
  if (!session.ok) return session;
  const { ctx } = session;
  const satisfied = await sessionIsStrong({ supabase: ctx.supabase, userId: ctx.userId, sessionId: ctx.sessionId });
  if (!satisfied) return { ok: false, error: "Verify a sign-in code or use your passkey first, then turn this off." };

  const { data: factors, error: listErr } = await ctx.supabase.auth.mfa.listFactors();
  if (listErr) return { ok: false, error: listErr.message };
  const mine = (factors?.all ?? []).find((factor) => factor.id === factorId && factor.status === "verified");
  if (!mine) return { ok: false, error: "That verification method isn't on this account." };

  const methods = await loadAuthMethods({
    supabase: ctx.supabase,
    admin: createAdminClient(),
    userId: ctx.userId,
    emailFlag: ctx.emailFlag,
  });
  if (!methods.ok) return { ok: false, error: methods.error };
  if (removalWouldLeaveNone(methods.methods, factorBucket(mine.factor_type))) return { ok: false, error: LAST_METHOD_MESSAGE };

  const { data: aal } = await ctx.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") {
    const { error } = await ctx.supabase.auth.mfa.unenroll({ factorId });
    if (!error) return { ok: true };
    if (isLastMethodError(error.message)) return { ok: false, error: LAST_METHOD_MESSAGE };
    if (!/aal/i.test(error.message)) return { ok: false, error: error.message };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.mfa.deleteFactor({ id: factorId, userId: ctx.userId });
  if (error) return { ok: false, error: isLastMethodError(error.message) ? LAST_METHOD_MESSAGE : error.message };
  return { ok: true };
}

/** Password update when GoTrue refuses an aal1 session and the person just proved
    the email factor. Strength is still checked by the admin password API. This is
    not used for authenticator or text codes — those call mfa.verify and become aal2. */
export async function setPasswordAfterVerifiedEmail(userId: string, password: string): Promise<EmailMfaResult> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, error: error.message || "Couldn't update your password." };
  return { ok: true };
}
