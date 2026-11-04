"use server";

import { deliverPasswordReset } from "@/lib/sendPasswordReset";

/* Public "forgot password" entry point. Always returns ok and never reveals
   whether an account exists for the email — Supabase's resetPasswordForEmail
   does the same, and we swallow errors so a rate-limit or redirect-config
   failure can't be told apart from a missing account.

   Sends Supabase Auth's reset email (not the Mailgun invite/admin reset). The
   link lands on /auth/set-password. Shares the mobile forgot-password rate
   buckets so one inbox can't be hit from both surfaces. */

export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  await deliverPasswordReset(email);
  return { ok: true };
}
