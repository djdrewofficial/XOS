"use server";

import { revalidatePath } from "next/cache";
import {
  deleteSupabaseFactorAfterEmailCode,
  disableEmailMfaForSession,
  emailFactorStatus,
  sendEmailMfaCodeForSession,
  unenrollVerifiedFactorForSession,
  verifyEmailMfaCodeForSession,
  type EmailMfaResult,
} from "@/lib/emailMfaServer";
import { isEmailMfaPurpose, type EmailMfaPurpose } from "@/lib/emailMfa";
import { maskEmail } from "@/lib/mfaMethods";

export async function emailMfaAvailability(): Promise<{ ready: boolean; enrolled: boolean; hint: string | null }> {
  const status = await emailFactorStatus();
  return { ready: status.ready, enrolled: status.enrolled, hint: status.email ? maskEmail(status.email) : null };
}

export async function sendEmailMfaCode(purpose: EmailMfaPurpose): Promise<EmailMfaResult> {
  if (!isEmailMfaPurpose(purpose)) return { ok: false, error: "Couldn't send a verification code." };
  return sendEmailMfaCodeForSession(purpose);
}

export async function verifyEmailMfaCode(purpose: EmailMfaPurpose, code: string): Promise<EmailMfaResult> {
  if (!isEmailMfaPurpose(purpose)) return { ok: false, error: "That code didn't work." };
  const result = await verifyEmailMfaCodeForSession(purpose, code);
  if (result.ok) revalidatePath("/account/security");
  return result;
}

export async function disableEmailMfa(): Promise<EmailMfaResult> {
  const result = await disableEmailMfaForSession();
  if (result.ok) revalidatePath("/account/security");
  return result;
}

export async function turnOffVerifiedFactor(factorId: string): Promise<EmailMfaResult> {
  const result = await unenrollVerifiedFactorForSession(factorId);
  if (result.ok) revalidatePath("/account/security");
  return result;
}

export async function removeSupabaseFactorWithEmailCode(factorId: string, code: string): Promise<EmailMfaResult> {
  const result = await deleteSupabaseFactorAfterEmailCode(factorId, code);
  if (result.ok) revalidatePath("/account/security");
  return result;
}
