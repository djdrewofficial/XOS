import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientIpFromHeaders, isRateLimited, recordRateHit } from "@/lib/rateLimit";
import { passwordResetRedirect } from "@/lib/passwordReset";

/* Shared sender for the public forgot-password page and My Account's
   "Email me a reset link". The public page always hides the result. The
   signed-in action can tell the person what happened because the address
   is their own session email, never a value they typed. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 60 * 60 * 1000;
const MAX_PER_EMAIL_PER_HOUR = 3;
const MAX_PER_IP_PER_HOUR = 10;

export type PasswordResetDelivery = "sent" | "limited" | "invalid" | "failed";

export async function deliverPasswordReset(email: string): Promise<PasswordResetDelivery> {
  const addr = (email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return "invalid";

  try {
    const h = await headers();
    try {
      const admin = createAdminClient();
      const ip = clientIpFromHeaders(h);
      const overEmail = await isRateLimited(admin, "pwreset:email", addr, MAX_PER_EMAIL_PER_HOUR, HOUR);
      const overIp = ip ? await isRateLimited(admin, "pwreset:ip", ip, MAX_PER_IP_PER_HOUR, HOUR) : false;
      if (overEmail || overIp) return "limited";
      await recordRateHit(admin, "pwreset:email", addr, HOUR);
      if (ip) await recordRateHit(admin, "pwreset:ip", ip, HOUR);
    } catch (err) {
      // Rate-limit storage is best-effort. A missing service key must not
      // block the reset email.
      console.error("password reset rate limit skipped:", err instanceof Error ? err.message : "unknown");
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(addr, {
      redirectTo: passwordResetRedirect(h),
    });
    if (error) {
      console.error("password reset email failed:", error.message);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("password reset email failed:", err instanceof Error ? err.message : "unknown");
    return "failed";
  }
}
