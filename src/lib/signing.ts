/* Shared helpers for the client signing flow (phase 2). */

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/* Branded transactional email shell for signing-related sends. */
export function signingEmailHtml({
  heading,
  bodyHtml,
  buttonLabel,
  buttonUrl,
  companyName,
}: {
  heading: string;
  bodyHtml: string;
  buttonLabel: string;
  buttonUrl: string;
  companyName: string;
}): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f2fa;font-family:ui-sans-serif,system-ui,Segoe UI,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;">
    <div style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e8e4f3;">
      <div style="background:linear-gradient(110deg,#4b328e 0%,#8b6fd6 100%);padding:26px 30px;">
        <div style="color:#ffffff;font-size:20px;font-weight:800;">${companyName}</div>
      </div>
      <div style="padding:28px 30px;color:#2c2c33;font-size:15px;line-height:1.65;">
        <h1 style="margin:0 0 12px;font-size:21px;color:#1d1d22;">${heading}</h1>
        ${bodyHtml}
        <div style="text-align:center;margin:26px 0 8px;">
          <a href="${buttonUrl}" style="display:inline-block;background:#4b328e;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 34px;border-radius:10px;">${buttonLabel}</a>
        </div>
        <p style="font-size:12px;color:#8a8a94;margin:18px 0 0;">If the button doesn't work, copy this link into your browser:<br/><a href="${buttonUrl}" style="color:#4b328e;word-break:break-all;">${buttonUrl}</a></p>
      </div>
      <div style="padding:16px 30px;border-top:1px solid #efecf7;color:#8a8a94;font-size:12px;">${companyName}</div>
    </div>
  </div>
</body></html>`;
}
