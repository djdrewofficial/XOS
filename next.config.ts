import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF engine: keep puppeteer/chromium out of the webpack bundle and force the
  // chromium binaries into the serverless function's traced files
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/api/dev-pdf-test": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
