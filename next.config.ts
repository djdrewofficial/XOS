import type { NextConfig } from "next";

// Security response headers applied to every route. Kept to the high-value,
// app-safe set (no CSP yet — a strict CSP needs per-route testing against the
// Supabase/Mailgun/GHL/image origins the app talks to, tracked as a follow-up).
const securityHeaders = [
  // force HTTPS for 2 years; only affects *.xos.xpressdjs.com, not sibling domains
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // stop MIME-sniffing (defends against content-type confusion attacks)
  { key: "X-Content-Type-Options", value: "nosniff" },
  // disallow being framed by other sites (clickjacking)
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // don't leak full URLs/paths to third parties in the Referer header
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // turn off powerful browser features the app doesn't use
  { key: "Permissions-Policy", value: "browsing-topics=(), interest-cohort=(), payment=()" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  // PDF engine: keep puppeteer/chromium out of the webpack bundle and force the
  // chromium binaries into the serverless function's traced files
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/api/dev-pdf-test": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
