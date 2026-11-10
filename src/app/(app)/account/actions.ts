"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { verifyEmailMfaCodeForSession, setPasswordAfterVerifiedEmail, currentEmailStepUp } from "@/lib/emailMfaServer";
import { elevateSessionWithPhone, elevateSessionWithTotp, passwordChangeNeedsTotp } from "@/lib/mfaStepUp";
import { sessionIdFromAccessToken } from "@/lib/mfaStepUpCookie";
import type { MfaMethod } from "@/lib/mfaMethods";
import {
  PASSWORD_CHANGE_MFA_PROMPT,
  PASSWORD_CHANGE_NONCE_PROMPT,
  classifyCurrentPasswordError,
  currentPasswordErrorMessage,
  isInsufficientAal,
  nextPasswordChangeStep,
} from "@/lib/passwordChange";
import { passwordMeetsPolicy, validatePasswordChange } from "@/lib/passwordPolicy";
import { deliverPasswordReset } from "@/lib/sendPasswordReset";
import { syncEmployeeLoginPhone } from "@/lib/loginPhoneAdmin";
import { flashPhoneNotice } from "@/lib/phoneNotice";
import type { PasswordChangeResult } from "./passwordChangeResult";

/* Self-service profile edits. Every write is scoped to the CALLER'S OWN employee
   row (resolved from the session, never client-supplied) and limited to a safe
   whitelist — no permission tier, wages, category, active flag, or sending
   identity. Uses the service-role client so it works regardless of the employees
   table's RLS, but only ever touches the caller's own id. */

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

async function myEmployeeId(): Promise<string> {
  const me = await getMe();
  if (!me || me.accountType !== "staff" || !me.employeeId) throw new Error("No staff profile to edit.");
  return me.employeeId;
}

export async function updateMyProfile(formData: FormData) {
  const id = await myEmployeeId();
  const admin = createAdminClient();
  const { data: before } = await admin.from("employees").select("phone").eq("id", id).maybeSingle();
  const phone = clean(formData.get("phone"));
  const { error } = await admin
    .from("employees")
    .update({
      first_name: clean(formData.get("first_name")) ?? "",
      last_name: clean(formData.get("last_name")),
      middle_name: clean(formData.get("middle_name")),
      stage_name: clean(formData.get("stage_name")),
      bio: clean(formData.get("bio")),
      phone,
      website: clean(formData.get("website")),
      planning_meeting_url: clean(formData.get("planning_meeting_url")),
      address: clean(formData.get("address")),
      emergency_contact: clean(formData.get("emergency_contact")),
      birthday: clean(formData.get("birthday")),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  const sync = await syncEmployeeLoginPhone(id, phone, before?.phone ?? null);
  if (sync.notice) await flashPhoneNotice(sync.notice);
  revalidatePath("/account");
}

export async function uploadMyPhoto(formData: FormData) {
  const id = await myEmployeeId();
  const admin = createAdminClient();
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return;
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${id}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await admin.storage
    .from("staff")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);
  const { error } = await admin.from("employees").update({ photo_path: path }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/account");
}

/* Change the signed-in user's own password. The current password is checked
   with a throwaway client so a wrong guess can't replace this browser's
   session cookie. That extra session is revoked immediately.

   Secure password change (session older than a day) is finished with
   reauthenticate() and the emailed nonce. Signing in again on the real
   session does not satisfy that check, and for an account with 2FA it would
   replace the aal2 cookie with an aal1 session and lock the password update. */
export async function changeMyPassword(input: {
  current: string;
  next: string;
  confirm: string;
  nonce?: string;
  totp?: string;
  method?: MfaMethod;
  phoneFactorId?: string;
  phoneChallengeId?: string;
  emailCode?: string;
}): Promise<PasswordChangeResult> {
  const validated = validatePasswordChange(input);
  if (!validated.ok) return validated;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email;
  if (!email) return { ok: false, error: "You need to be signed in again." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, error: "Password change is unavailable right now." };

  const verifier = createSupabaseJsClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: pwErr } = await verifier.auth.signInWithPassword({
    email,
    password: input.current,
  });
  const check = classifyCurrentPasswordError(pwErr);
  if (check !== "match") return { ok: false, error: currentPasswordErrorMessage(check, pwErr) };
  if (verified.session) {
    // Drop only the throwaway session. scope "local" uses its own token.
    await verifier.auth.signOut({ scope: "local" }).catch(() => {});
  }

  let emailVerifiedNow = false;
  if (await passwordChangeNeedsTotp(supabase)) {
    const method = input.method ?? "totp";
    if (method === "phone") {
      if (!input.phoneFactorId || !input.phoneChallengeId) {
        return { ok: false, needsMfa: true, error: "Text yourself a code first." };
      }
      const mfaError = await elevateSessionWithPhone(supabase, {
        factorId: input.phoneFactorId,
        challengeId: input.phoneChallengeId,
        code: input.totp ?? "",
      });
      if (mfaError) return { ok: false, needsMfa: true, error: mfaError };
    } else if (method === "email") {
      const verified = await verifyEmailMfaCodeForSession("signin", input.emailCode ?? "");
      if (!verified.ok) return { ok: false, needsMfa: true, error: verified.error };
      emailVerifiedNow = true;
    } else {
      const totp = input.totp ?? "";
      if (!totp.trim()) return { ok: false, needsMfa: true, error: PASSWORD_CHANGE_MFA_PROMPT };
      const mfaError = await elevateSessionWithTotp(supabase, totp);
      if (mfaError) return { ok: false, needsMfa: true, error: mfaError };
    }
  } else if (user.app_metadata?.email_mfa === true) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const stepped = await currentEmailStepUp(user.id, sessionIdFromAccessToken(session?.access_token));
    if (!stepped) {
      const verified = await verifyEmailMfaCodeForSession("signin", input.emailCode ?? "");
      if (!verified.ok) return { ok: false, needsMfa: true, error: verified.error };
      emailVerifiedNow = true;
    }
  }

  const nonce = input.nonce?.trim() || undefined;
  const { error: updateError } = await supabase.auth.updateUser({
    password: input.next,
    current_password: input.current,
    ...(nonce ? { nonce } : {}),
  });
  if (updateError && isInsufficientAal(updateError) && emailVerifiedNow) {
    // Auth has no email factor, so a session that only proved email stays aal1
    // and updateUser refuses while an authenticator or phone factor exists.
    // The current password was checked above and the email code was single-use.
    const fallback = await setPasswordAfterVerifiedEmail(user.id, input.next);
    if (!fallback.ok) return fallback;
    await supabase.auth.signOut({ scope: "others" });
    return { ok: true };
  }
  if (updateError) {
    const step = nextPasswordChangeStep({ error: updateError, hasNonce: Boolean(nonce) });
    if (step.action === "send-nonce") {
      const { error: reauthError } = await supabase.auth.reauthenticate();
      if (reauthError) {
        return { ok: false, error: reauthError.message || "Couldn't send a confirmation code. Try again." };
      }
      return { ok: false, needsNonce: true, error: PASSWORD_CHANGE_NONCE_PROMPT };
    }
    if (step.action === "step-up-mfa") {
      return { ok: false, needsMfa: true, error: PASSWORD_CHANGE_MFA_PROMPT };
    }
    return { ok: false, error: step.error };
  }

  await supabase.auth.signOut({ scope: "others" });
  return { ok: true };
}

function isRecoverySession(methods: { method?: string }[] | string[] | null | undefined): boolean {
  return (methods ?? []).some((entry) => (typeof entry === "string" ? entry : entry.method) === "recovery");
}

/** Set a password from the reset-link page when the backup factor is email.
    Refuses a normal signed-in session so this cannot skip the current password.
    Authenticator and text codes still go through mfa.verify on that page. */
export async function setPasswordWithEmailCode(input: {
  next: string;
  confirm: string;
  code: string;
}): Promise<PasswordChangeResult> {
  if (!passwordMeetsPolicy(input.next)) return { ok: false, error: "Your password doesn't meet all the requirements." };
  if (input.next !== input.confirm) return { ok: false, error: "Passwords don't match." };
  if (input.next.length > 256) return { ok: false, error: "That password is too long." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in again." };
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!isRecoverySession(aal?.currentAuthenticationMethods)) {
    return { ok: false, error: "Open the reset link from your email, or change the password from My Account." };
  }

  const verified = await verifyEmailMfaCodeForSession("signin", input.code);
  if (!verified.ok) return { ok: false, needsMfa: true, error: verified.error };

  const { error: updateError } = await supabase.auth.updateUser({ password: input.next });
  if (updateError && isInsufficientAal(updateError)) {
    const fallback = await setPasswordAfterVerifiedEmail(user.id, input.next);
    if (!fallback.ok) return fallback;
  } else if (updateError) {
    const step = nextPasswordChangeStep({ error: updateError, hasNonce: false });
    if (step.action === "send-nonce") {
      const { error: reauthError } = await supabase.auth.reauthenticate();
      if (reauthError) return { ok: false, error: reauthError.message || "Couldn't send a confirmation code. Try again." };
      return { ok: false, needsNonce: true, error: PASSWORD_CHANGE_NONCE_PROMPT };
    }
    if (step.action === "step-up-mfa") return { ok: false, needsMfa: true, error: PASSWORD_CHANGE_MFA_PROMPT };
    return { ok: false, error: step.error };
  }

  await supabase.auth.signOut({ scope: "others" });
  return { ok: true };
}

/** Email a fresh secure-password-change code without trying the password update again. */
export async function sendPasswordChangeCode(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in again." };
  const { error } = await supabase.auth.reauthenticate();
  if (error) return { ok: false, error: error.message || "Couldn't send a confirmation code. Try again." };
  return { ok: true };
}

/** Reset link to the signed-in account's own email. Reuses the forgot-password sender. */
export async function emailMyPasswordReset(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email;
  if (!email) return { ok: false, error: "You need to be signed in again." };
  const result = await deliverPasswordReset(email);
  if (result === "limited") return { ok: false, error: "Too many reset emails. Wait a while and try again." };
  if (result !== "sent") return { ok: false, error: "We couldn't send the reset email. Try again in a few minutes." };
  return { ok: true };
}
