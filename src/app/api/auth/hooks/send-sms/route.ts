import { sendDirectSms } from "@/lib/highlevel";
import { toE164 } from "@/lib/phone";
import { handleSendSmsHook } from "@/lib/sendSmsHook";

/* Supabase Auth → Send SMS hook for xpress-client phone OTP.
   Dashboard → Authentication → Hooks → Send SMS:
     https://xos.xpressdjs.com/api/auth/hooks/send-sms
   Secret: SEND_SMS_HOOK_SECRET (full `v1,whsec_...` value, Netlify env only).

   Middleware exempts this exact path from the Cloudflare origin lock and the
   login wall. Supabase calls it with no staff session and without the
   x-origin-verify header; the Standard Webhooks signature is the check.
   Do not open the rest of /api/auth.

   SMS goes out through sendDirectSms — the same HighLevel contact upsert and
   conversations/messages call the outbox uses. The from-number is the SMS
   number on HIGHLEVEL_LOCATION_ID. The code is not stored in sms_log. */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleSendSmsHook(req, {
    secret: process.env.SEND_SMS_HOOK_SECRET,
    normalizePhone: toE164,
    sendSms: ({ phone, body }) => sendDirectSms({ phone, body }),
  });
}
