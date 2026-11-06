import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { isOwnerEmail } from "@/lib/permissions";
import { permCacheSecret } from "@/lib/permSnapshot";
import { sessionIdFromAccessToken } from "@/lib/mfaStepUpCookie";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientIpFromHeaders } from "@/lib/rateLimit";
import { loadAuthMethods, sessionIsStrong } from "@/lib/strongAuthServer";
import {
  LAST_METHOD_MESSAGE,
  PASSKEY_AUTHENTICATOR_SELECTION,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_MAX_PER_USER,
  PASSKEY_RP_NAME,
  PASSKEY_UV,
  classifyWebAuthnError,
  cleanPasskeyName,
  cleanTransports,
  clientDataFields,
  counterDecision,
  decideAuthenticationOutcome,
  decideRegistrationOutcome,
  defaultPasskeyName,
  isAuthenticationResponse,
  isLastMethodError,
  isMissingPasskeySchema,
  isPasskeyChallenge,
  isRegistrationResponse,
  methodCount,
  originFromHeaders,
  passkeyBindingForOrigin,
  passkeyEnvFrom,
  passkeyFailureMessage,
  registrationAllowed,
  removalWouldLeaveNone,
  userHandleMatches,
  uuidToBytes,
  webAuthnAuthenticationCheck,
  webAuthnRegistrationCheck,
  type PasskeyBinding,
  type PasskeySummary,
} from "@/lib/passkey";
import {
  MFA_PASSKEY_COOKIE,
  MFA_PASSKEY_STEPUP_TTL_SEC,
  signMfaPasskeyStepUp,
} from "@/lib/passkeyStepUpCookie";

export type PasskeyResult = { ok: true } | { ok: false; error: string };

export type { PasskeySummary };

type StaffCtx = {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  email: string;
  emailFlag: boolean;
  sessionId: string;
  displayName: string;
};

type PublicKeyCredentialCreationOptionsJSON = Awaited<ReturnType<typeof generateRegistrationOptions>>;
type PublicKeyCredentialRequestOptionsJSON = Awaited<ReturnType<typeof generateAuthenticationOptions>>;

const SETUP = passkeyFailureMessage("setup");

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

function fail(reason: string): { ok: false; error: string } {
  return { ok: false, error: passkeyFailureMessage(reason) };
}

function statusOf(data: unknown): string {
  if (!data || typeof data !== "object" || !("status" in data)) return "";
  const status = (data as { status: unknown }).status;
  return typeof status === "string" ? status : "";
}

function fieldOf(data: unknown, key: string): string | null {
  if (!data || typeof data !== "object" || !(key in data)) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

async function staffContext(): Promise<{ ok: true; ctx: StaffCtx } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.email) return { ok: false, error: "You need to be signed in again." };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sessionId = sessionIdFromAccessToken(session?.access_token);
  if (!sessionId || session?.user.id !== user.id) return { ok: false, error: "You need to be signed in again." };

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Passkeys aren't available right now." };
  }
  const staff = await userIsStaff(admin, user.id, user.email);
  if (!staff) return { ok: false, error: "Passkeys are for staff sign-in." };
  return {
    ok: true,
    ctx: {
      supabase,
      admin,
      userId: user.id,
      email: user.email,
      emailFlag: user.app_metadata?.email_mfa === true,
      sessionId,
      displayName: await staffDisplayName(admin, user.id, user.email),
    },
  };
}

async function userIsStaff(admin: SupabaseClient, userId: string, email: string): Promise<boolean> {
  const { data, error } = await admin.from("employees").select("id").eq("auth_user_id", userId).maybeSingle();
  if (error) return false;
  if (data) return true;
  return isOwnerEmail(email);
}

async function staffDisplayName(admin: SupabaseClient, userId: string, email: string): Promise<string> {
  const { data } = await admin
    .from("employees")
    .select("first_name, last_name")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const full = [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim();
  return full || email;
}

function bindingFor(request: Request): PasskeyBinding | null {
  return passkeyBindingForOrigin(originFromHeaders(request.headers), passkeyEnvFrom(process.env));
}

function ipHash(request: Request): string | null {
  const ip = clientIpFromHeaders(request.headers);
  const pepper = permCacheSecret();
  if (!ip || !pepper) return null;
  return createHash("sha256").update(`passkey:${pepper}:${ip}`).digest("hex");
}

async function stampPasskeyCookie(userId: string, sessionId: string): Promise<boolean> {
  const secret = permCacheSecret();
  if (!secret) return false;
  const value = await signMfaPasskeyStepUp(
    { uid: userId, sid: sessionId, exp: Math.floor(Date.now() / 1000) + MFA_PASSKEY_STEPUP_TTL_SEC },
    secret,
  );
  const jar = await cookies();
  jar.set(MFA_PASSKEY_COOKIE, value, cookieOptions(MFA_PASSKEY_STEPUP_TTL_SEC));
  return true;
}

async function setPasskeyFlag(admin: SupabaseClient, userId: string, on: boolean): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...(data.user.app_metadata ?? {}), passkey_mfa: on },
  });
  return !updateErr;
}

function dbError(error: { message: string; code?: string } | null, fallback: string): { ok: false; error: string } {
  if (!error) return { ok: false, error: fallback };
  // SQLSTATE and message only. details/hint can echo the row, including the public key.
  console.error("passkey database error:", error.code ?? "", error.message);
  if (isMissingPasskeySchema(error.message)) return { ok: false, error: SETUP };
  if (isLastMethodError(error.message)) return { ok: false, error: LAST_METHOD_MESSAGE };
  return { ok: false, error: fallback };
}

export async function passkeyRegistrationOptions(request: Request): Promise<
  { ok: true; options: PublicKeyCredentialCreationOptionsJSON } | PasskeyResult
> {
  const session = await staffContext();
  if (!session.ok) return session;
  const { ctx } = session;
  const binding = bindingFor(request);
  if (!binding) return fail("origin");

  const loaded = await loadAuthMethods({
    supabase: ctx.supabase,
    admin: ctx.admin,
    userId: ctx.userId,
    emailFlag: ctx.emailFlag,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const satisfied = await sessionIsStrong({ supabase: ctx.supabase, userId: ctx.userId, sessionId: ctx.sessionId });
  if (!registrationAllowed({ sessionSatisfied: satisfied, methodCount: methodCount(loaded.methods) })) {
    return fail("forbidden");
  }
  if (loaded.methods.passkeys >= PASSKEY_MAX_PER_USER) return fail("full");

  const { data: existing, error: listErr } = await ctx.admin
    .from("staff_passkeys")
    .select("credential_id, transports")
    .eq("user_id", ctx.userId);
  if (listErr) return dbError(listErr, "Couldn't start adding a passkey.");

  const userID = uuidToBytes(ctx.userId);
  if (!userID) return { ok: false, error: "Couldn't start adding a passkey." };
  const userIdBytes = new Uint8Array(userID);

  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME,
    rpID: binding.rpId,
    userName: ctx.email,
    userDisplayName: ctx.displayName,
    userID: userIdBytes,
    attestationType: "none",
    authenticatorSelection: PASSKEY_AUTHENTICATOR_SELECTION,
    excludeCredentials: (existing ?? []).map((row) => ({
      id: row.credential_id as string,
      transports: cleanTransports(row.transports as string[] | undefined),
    })),
  });
  if (!isPasskeyChallenge(options.challenge)) return { ok: false, error: "Couldn't start adding a passkey." };

  const stored = await storeChallenge(ctx.admin, {
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    kind: "register",
    challenge: options.challenge,
    binding,
    ipHash: ipHash(request),
  });
  if (!stored.ok) return stored;
  return { ok: true, options };
}

export async function passkeyRegistrationVerify(
  request: Request,
  response: unknown,
  name: unknown,
): Promise<PasskeyResult> {
  const session = await staffContext();
  if (!session.ok) return session;
  const { ctx } = session;
  if (!isRegistrationResponse(response)) return fail("unverified");
  const fields = clientDataFields(response.response.clientDataJSON);
  if (!fields || fields.type !== "webauthn.create") return fail("challenge");
  const binding = passkeyBindingForOrigin(fields.origin, passkeyEnvFrom(process.env));
  if (!binding) return fail("origin");

  const loaded = await loadAuthMethods({
    supabase: ctx.supabase,
    admin: ctx.admin,
    userId: ctx.userId,
    emailFlag: ctx.emailFlag,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const satisfied = await sessionIsStrong({ supabase: ctx.supabase, userId: ctx.userId, sessionId: ctx.sessionId });
  if (!registrationAllowed({ sessionSatisfied: satisfied, methodCount: methodCount(loaded.methods) })) {
    return fail("forbidden");
  }
  if (loaded.methods.passkeys >= PASSKEY_MAX_PER_USER) return fail("full");

  const consumed = await consumeChallenge(ctx.admin, {
    challenge: fields.challenge,
    kind: "register",
    userId: ctx.userId,
    sessionId: ctx.sessionId,
  });
  if (!consumed.ok) return consumed;
  if (consumed.origin !== binding.origin || consumed.rpId !== binding.rpId) return fail("origin");

  let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verified = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      ...webAuthnRegistrationCheck({
        expectedChallenge: fields.challenge,
        expectedOrigin: binding.origin,
        expectedRPID: binding.rpId,
      }),
    });
  } catch (error) {
    return fail(classifyWebAuthnError(error));
  }
  const info = verified.verified ? verified.registrationInfo : null;
  const decision = decideRegistrationOutcome({
    verified: Boolean(info),
    userVerified: info?.userVerified === true,
    originAllowed: info?.origin === binding.origin,
    rpIdMatches: info?.rpID === binding.rpId,
    challengeOk: true,
    staffUser: true,
  });
  if (!decision.ok) return fail(decision.reason);
  if (!info) return fail("unverified");

  const credentialId = info.credential.id;
  const publicKey = isoBase64URL.fromBuffer(info.credential.publicKey);
  if (credentialId !== response.id || !publicKey) return fail("unverified");
  const deviceType = info.credentialDeviceType === "multiDevice" ? "multiDevice" : "singleDevice";
  const passkeyName = cleanPasskeyName(
    name,
    defaultPasskeyName(request.headers.get("user-agent"), info.credentialBackedUp),
  );

  const firstPasskey = loaded.methods.passkeys === 0;
  if (firstPasskey) {
    const flagged = await setPasskeyFlag(ctx.admin, ctx.userId, true);
    if (!flagged) return { ok: false, error: "Couldn't save that passkey. Try again." };
  }
  const { error: insertErr } = await ctx.admin.from("staff_passkeys").insert({
    user_id: ctx.userId,
    credential_id: credentialId,
    public_key: publicKey,
    counter: info.credential.counter,
    transports: cleanTransports(response.response.transports),
    device_type: deviceType,
    backed_up: info.credentialBackedUp,
    name: passkeyName,
    rp_id: binding.rpId,
  });
  if (insertErr) {
    if (firstPasskey) await setPasskeyFlag(ctx.admin, ctx.userId, false);
    if (/duplicate|unique/i.test(insertErr.message)) return { ok: false, error: "That passkey is already saved on this account." };
    return dbError(insertErr, "Couldn't save that passkey.");
  }

  const stamped = await stampPasskeyCookie(ctx.userId, ctx.sessionId);
  if (!stamped) return { ok: false, error: "The passkey was saved. Sign in with it to finish." };
  return { ok: true };
}

export async function passkeyAuthenticationOptions(
  request: Request,
  ceremony: "login" | "stepup",
): Promise<{ ok: true; options: PublicKeyCredentialRequestOptionsJSON } | PasskeyResult> {
  const binding = bindingFor(request);
  if (!binding) return fail("origin");

  let userId: string | null = null;
  let sessionId: string | null = null;
  let allowCredentials: { id: string; transports?: string[] }[] | undefined;
  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Passkeys aren't available right now." };
  }

  if (ceremony === "stepup") {
    const session = await staffContext();
    if (!session.ok) return session;
    userId = session.ctx.userId;
    sessionId = session.ctx.sessionId;
    const { data: rows, error } = await admin
      .from("staff_passkeys")
      .select("credential_id, transports")
      .eq("user_id", userId);
    if (error) return dbError(error, "Couldn't start the passkey sign-in.");
    if (!rows?.length) return fail("credential");
    allowCredentials = rows.map((row) => ({
      id: row.credential_id as string,
      transports: cleanTransports(row.transports as string[] | undefined),
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID: binding.rpId,
    userVerification: PASSKEY_UV,
    ...(allowCredentials ? { allowCredentials } : {}),
  });
  if (!isPasskeyChallenge(options.challenge)) return { ok: false, error: "Couldn't start the passkey sign-in." };

  const stored = await storeChallenge(admin, {
    userId,
    sessionId,
    kind: "authenticate",
    challenge: options.challenge,
    binding,
    ipHash: ipHash(request),
  });
  if (!stored.ok) return stored;
  return { ok: true, options };
}

export async function passkeyAuthenticationVerify(
  request: Request,
  ceremony: "login" | "stepup",
  response: unknown,
): Promise<PasskeyResult> {
  if (!isAuthenticationResponse(response)) return fail("unverified");
  const fields = clientDataFields(response.response.clientDataJSON);
  if (!fields || fields.type !== "webauthn.get") return fail("challenge");
  const binding = passkeyBindingForOrigin(fields.origin, passkeyEnvFrom(process.env));
  if (!binding) return fail("origin");

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Passkeys aren't available right now." };
  }

  let stepUp: StaffCtx | null = null;
  if (ceremony === "stepup") {
    const session = await staffContext();
    if (!session.ok) return session;
    stepUp = session.ctx;
  }

  const consumed = await consumeChallenge(admin, {
    challenge: fields.challenge,
    kind: "authenticate",
    userId: stepUp?.userId ?? null,
    sessionId: stepUp?.sessionId ?? null,
  });
  if (!consumed.ok) return consumed;
  if (consumed.origin !== binding.origin || consumed.rpId !== binding.rpId) return fail("origin");

  const { data: credential, error: credErr } = await admin
    .from("staff_passkeys")
    .select("id, user_id, credential_id, public_key, counter, rp_id")
    .eq("credential_id", response.id)
    .maybeSingle();
  if (credErr) return dbError(credErr, "That passkey didn't work. Try again.");
  if (!credential) return fail("credential");
  if (stepUp && credential.user_id !== stepUp.userId) return fail("credential");

  const storedCounter = Number(credential.counter);
  const publicKey = isoBase64URL.toBuffer(credential.public_key as string);
  let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    const check = webAuthnAuthenticationCheck({
      expectedChallenge: fields.challenge,
      expectedOrigin: binding.origin,
      expectedRPID: binding.rpId,
      credentialId: credential.credential_id as string,
      publicKey: Uint8Array.from(publicKey),
      counter: storedCounter,
    });
    verified = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: check.expectedChallenge,
      expectedOrigin: check.expectedOrigin,
      expectedRPID: check.expectedRPID,
      requireUserVerification: true,
      credential: {
        id: check.credential.id,
        publicKey: check.credential.publicKey as Uint8Array<ArrayBuffer>,
        counter: check.credential.counter,
      },
    });
  } catch (error) {
    return fail(classifyWebAuthnError(error));
  }

  const info = verified.authenticationInfo;
  const { data: account, error: userErr } = await admin.auth.admin.getUserById(credential.user_id as string);
  if (userErr || !account.user?.email) return fail("staff");
  if (account.user.banned_until && Date.parse(account.user.banned_until) > Date.now()) {
    return { ok: false, error: "This account is disabled." };
  }
  const staffUser = await userIsStaff(admin, account.user.id, account.user.email);
  const decision = decideAuthenticationOutcome({
    verified: verified.verified,
    userVerified: info.userVerified === true,
    originAllowed: info.origin === binding.origin,
    rpIdMatches: info.rpID === binding.rpId && credential.rp_id === binding.rpId,
    challengeOk: true,
    credentialFound: true,
    counter: counterDecision(storedCounter, info.newCounter),
    staffUser,
    userHandleOk: userHandleMatches(response.response.userHandle, credential.user_id as string),
    nextCounter: info.newCounter,
  });
  if (!decision.ok) return fail(decision.reason);

  const noted = await admin.rpc("xos_passkey_note_use", {
    p_credential_id: credential.credential_id,
    p_new_counter: decision.nextCounter,
  });
  if (noted.error) return dbError(noted.error, "That passkey didn't work. Try again.");
  const notedStatus = statusOf(noted.data);
  if (notedStatus !== "ok") return fail(notedStatus === "clone" ? "counter" : "credential");

  if (account.user.app_metadata?.passkey_mfa !== true) {
    const flagged = await setPasskeyFlag(admin, account.user.id, true);
    if (!flagged) return { ok: false, error: "Couldn't finish passkey sign-in. Try again." };
  }

  if (stepUp) {
    const stamped = await stampPasskeyCookie(stepUp.userId, stepUp.sessionId);
    if (!stamped) return { ok: false, error: "Couldn't finish passkey sign-in. Try again." };
    return { ok: true };
  }

  // A Supabase session is opened only after the assertion above is accepted.
  const minted = await mintStaffSession(admin, account.user);
  if (!minted.ok) return minted;
  const stamped = await stampPasskeyCookie(account.user.id, minted.sessionId);
  if (!stamped) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    return { ok: false, error: "Couldn't finish passkey sign-in. Try again." };
  }
  return { ok: true };
}

/** Open a real Supabase session for a user who just proved a passkey.
    The magic-link token is created and consumed on the server. It is never
    sent to the browser, logged, or emailed. */
async function mintStaffSession(
  admin: SupabaseClient,
  user: User,
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  if (!user.email) return fail("staff");
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  const tokenHash = link?.properties?.hashed_token ?? "";
  if (linkErr || !tokenHash) return { ok: false, error: "Couldn't finish passkey sign-in. Try again." };

  const supabase = await createClient();
  const { data: verified, error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr || !verified.session || verified.user?.id !== user.id) {
    await supabase.auth.signOut();
    return { ok: false, error: "Couldn't finish passkey sign-in. Try again." };
  }
  const sessionId = sessionIdFromAccessToken(verified.session.access_token);
  if (!sessionId) {
    await supabase.auth.signOut();
    return { ok: false, error: "Couldn't finish passkey sign-in. Try again." };
  }
  return { ok: true, sessionId };
}

async function storeChallenge(
  admin: SupabaseClient,
  input: {
    userId: string | null;
    sessionId: string | null;
    kind: "register" | "authenticate";
    challenge: string;
    binding: PasskeyBinding;
    ipHash: string | null;
  },
): Promise<PasskeyResult> {
  const { data, error } = await admin.rpc("xos_passkey_challenge_begin", {
    p_user_id: input.userId,
    p_session_id: input.sessionId,
    p_kind: input.kind,
    p_challenge: input.challenge,
    p_origin: input.binding.origin,
    p_rp_id: input.binding.rpId,
    p_expires_at: new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MS).toISOString(),
    p_ip_hash: input.ipHash,
  });
  if (error) return dbError(error, "Couldn't start the passkey sign-in.");
  const status = statusOf(data);
  if (status !== "ok") return fail(status);
  return { ok: true };
}

async function consumeChallenge(
  admin: SupabaseClient,
  input: { challenge: string; kind: "register" | "authenticate"; userId: string | null; sessionId: string | null },
): Promise<{ ok: true; origin: string; rpId: string } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("xos_passkey_challenge_consume", {
    p_challenge: input.challenge,
    p_kind: input.kind,
    p_user_id: input.userId,
    p_session_id: input.sessionId,
  });
  if (error) return dbError(error, "That passkey check expired. Try again.");
  const status = statusOf(data);
  if (status !== "ok") return fail(status);
  const origin = fieldOf(data, "origin");
  const rpId = fieldOf(data, "rp_id");
  if (!origin || !rpId) return fail("challenge");
  return { ok: true, origin, rpId };
}

export async function listPasskeysForCurrentUser(): Promise<{ ready: boolean; passkeys: PasskeySummary[] }> {
  const session = await staffContext();
  if (!session.ok) return { ready: true, passkeys: [] };
  const { data, error } = await session.ctx.admin
    .from("staff_passkeys")
    .select("id, name, created_at, last_used_at, backed_up, device_type")
    .eq("user_id", session.ctx.userId)
    .order("created_at", { ascending: true });
  if (error) return { ready: !isMissingPasskeySchema(error.message), passkeys: [] };
  return {
    ready: true,
    passkeys: (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      createdAt: row.created_at as string,
      lastUsedAt: (row.last_used_at as string | null) ?? null,
      backedUp: Boolean(row.backed_up),
      deviceType: row.device_type === "multiDevice" ? "multiDevice" : "singleDevice",
    })),
  };
}

export async function renamePasskeyForSession(id: string, name: unknown): Promise<PasskeyResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "That passkey isn't on this account." };
  const session = await staffContext();
  if (!session.ok) return session;
  const { ctx } = session;
  if (typeof name !== "string" || !name.trim()) return { ok: false, error: "Enter a name for this passkey." };
  const cleaned = cleanPasskeyName(name, "Passkey");
  const { data, error } = await ctx.admin
    .from("staff_passkeys")
    .update({ name: cleaned })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select("id");
  if (error) return dbError(error, "Couldn't rename that passkey.");
  if (!data?.length) return { ok: false, error: "That passkey isn't on this account." };
  return { ok: true };
}

export async function removePasskeyForSession(id: string): Promise<PasskeyResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "That passkey isn't on this account." };
  const session = await staffContext();
  if (!session.ok) return session;
  const { ctx } = session;
  const satisfied = await sessionIsStrong({ supabase: ctx.supabase, userId: ctx.userId, sessionId: ctx.sessionId });
  if (!satisfied) return { ok: false, error: "Use your passkey or a verification code first, then remove it." };

  const loaded = await loadAuthMethods({
    supabase: ctx.supabase,
    admin: ctx.admin,
    userId: ctx.userId,
    emailFlag: ctx.emailFlag,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error };
  if (removalWouldLeaveNone(loaded.methods, "passkeys")) return { ok: false, error: LAST_METHOD_MESSAGE };

  const { data: row, error: readErr } = await ctx.admin
    .from("staff_passkeys")
    .select("id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, name, rp_id, created_at")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (readErr) return dbError(readErr, "Couldn't remove that passkey.");
  if (!row) return { ok: false, error: "That passkey isn't on this account." };

  const { error } = await ctx.admin.from("staff_passkeys").delete().eq("id", id).eq("user_id", ctx.userId);
  if (error) return dbError(error, "Couldn't remove that passkey.");

  const { count, error: countErr } = await ctx.admin
    .from("staff_passkeys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId);
  if (countErr) return { ok: true };
  const flagged = await setPasskeyFlag(ctx.admin, ctx.userId, (count ?? 0) > 0);
  if (!flagged && (count ?? 0) === 0) {
    await ctx.admin.from("staff_passkeys").insert({
      id: row.id,
      user_id: row.user_id,
      credential_id: row.credential_id,
      public_key: row.public_key,
      counter: row.counter,
      transports: row.transports,
      device_type: row.device_type,
      backed_up: row.backed_up,
      name: row.name,
      rp_id: row.rp_id,
      created_at: row.created_at,
    });
    return { ok: false, error: "Couldn't remove that passkey. Try again." };
  }
  return { ok: true };
}
