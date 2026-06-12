import { existsSync } from "node:fs";

/* HTML → PDF via headless Chromium.
   - Netlify/AWS: @sparticuz/chromium provides the binary
   - Local Windows dev: uses the installed Chrome/Edge */

const WINDOWS_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

export async function htmlToPdf(html: string): Promise<Buffer> {
  const puppeteer = (await import("puppeteer-core")).default;

  let executablePath: string | undefined = process.env.CHROME_PATH;
  let args: string[] = [];

  if (!executablePath && process.platform === "win32") {
    executablePath = WINDOWS_CHROME_PATHS.find((p) => existsSync(p));
  }
  if (!executablePath) {
    const chromium = (await import("@sparticuz/chromium")).default;
    executablePath = await chromium.executablePath();
    args = chromium.args;
  }
  if (!executablePath) throw new Error("No Chromium executable available for PDF rendering");

  const browser = await puppeteer.launch({
    executablePath,
    args: [...args, "--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    // give remote images (logo) a beat to finish
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const imgs = Array.from(document.images);
          if (imgs.every((i) => i.complete)) return resolve();
          let left = imgs.filter((i) => !i.complete).length;
          imgs.forEach((i) => {
            if (i.complete) return;
            i.addEventListener("load", () => --left || resolve());
            i.addEventListener("error", () => --left || resolve());
          });
          setTimeout(() => resolve(), 5000);
        })
    );
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      margin: { top: "0.45in", bottom: "0.45in", left: "0.45in", right: "0.45in" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
