"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientIpFromHeaders, isRateLimited, recordRateHit } from "@/lib/rateLimit";
import { passwordResetRedirect } from "@/lib/passwordReset";

/* Public "forgot password" entry point. Always returns ok and never reveals
   whether an account exists for the email — Supabase's resetPasswordForEmail
   does the same, and we swallow errors so a rate-limit or redirect-config
   failure can't be told apart from a missing account.

   Sends Supabase Auth's reset email (not the Mailgun invite/admin reset). The
   link lands on /auth/set-password. Shares the mobile forgot-password rate
   buckets so one inbox can't be hit from both surfaces. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 60 * 60 * 1000;
const MAX_PER_EMAIL_PER_HOUR = 3;
const MAX_PER_IP_PER_HOUR = 10;

export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const addr = (email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return { ok: true };

  try {
    const h = await headers();
    let limited = false;
    try {
      const admin = createAdminClient();
      const ip = clientIpFromHeaders(h);
      const overEmail = await isRateLimited(admin, "pwreset:email", addr, MAX_PER_EMAIL_PER_HOUR, HOUR);
      const overIp = ip ? await isRateLimited(admin, "pwreset:ip", ip, MAX_PER_IP_PER_HOUR, HOUR) : false;
      limited = overEmail || overIp;
      if (!limited) {
        await recordRateHit(admin, "pwreset:email", addr, HOUR);
        if (ip) await recordRateHit(admin, "pwreset:ip", ip, HOUR);
      }
    } catch (err) {
      // Rate-limit storage is best-effort. A missing service key must not
      // block the reset email.
      console.error("password reset rate limit skipped:", err instanceof Error ? err.message : "unknown");
    }
    if (limited) return { ok: true };

    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(addr, {
      redirectTo: passwordResetRedirect(h),
    });
    if (error) console.error("password reset email failed:", error.message);
  } catch (err) {
    console.error("password reset email failed:", err instanceof Error ? err.message : "unknown");
  }
  return { ok: true };
}
