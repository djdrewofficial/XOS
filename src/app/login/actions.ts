"use server";

import { sendPasswordReset } from "@/lib/accounts";

/* Public "forgot password" entry point. Always returns ok and never reveals
   whether an account exists for the email — prevents user enumeration from the
   login page. When a matching login does exist, sendPasswordReset emails the
   branded recovery link (landing on /auth/set-password). */
export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const addr = (email ?? "").trim();
  if (addr) {
    try {
      await sendPasswordReset(addr);
    } catch {
      /* swallow — the user always sees the same generic confirmation */
    }
  }
  return { ok: true };
}
