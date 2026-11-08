import type { Metadata } from "next";
import { DM_Serif_Display, Montserrat } from "next/font/google";
import { mobileResetView } from "@/lib/passwordResetPath";

/* Public bridge for the couple app's password email. The button opens
   xpressclient://auth/reset with a checked token hash. This page does not
   check the token, exchange a code, or adopt a session. Do not log the query. */

const display = DM_Serif_Display({ weight: "400", subsets: ["latin"], display: "swap" });
const sans = Montserrat({ weight: ["400", "700"], subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function queryFrom(search: Search): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value)) for (const item of value) query.append(key, item);
  }
  return query;
}

export default async function MobileResetPage({ searchParams }: { searchParams: Promise<Search> }) {
  const view = mobileResetView(queryFrom(await searchParams));
  const heading = view.state === "ready" ? "Reset your password" : view.state === "expired" ? "This reset link has expired" : view.state === "missing" ? "This reset link is incomplete" : "This reset link can't be used";
  const body =
    view.state === "ready"
      ? "We received a request to reset your password. Open the Xpress DJs app to choose a new one."
      : view.state === "expired"
        ? "Request a new password reset in the Xpress DJs app."
        : view.state === "missing"
          ? "Open the Xpress DJs app and request a new password reset."
          : "Open the Xpress DJs app and request a new password reset.";

  return (
    <main
      className={sans.className}
      style={{
        minHeight: "100vh",
        background: "#f6f2ff",
        color: "#120c1e",
        padding: "32px 16px",
      }}
    >
      <section
        style={{
          maxWidth: 560,
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <div style={{ background: "#4b328e", padding: "28px 24px", textAlign: "center" }}>
          <img
            src="/logo-dark.png"
            alt="Xpress Entertainment"
            width={220}
            height={97}
            style={{ display: "inline-block", width: 220, maxWidth: "100%", height: "auto" }}
          />
        </div>
        <div style={{ height: 4, background: "#fe3a3b" }} />
        <div style={{ padding: "32px 28px 30px" }}>
          <h1
            className={display.className}
            style={{ margin: "0 0 20px", color: "#120c1e", fontSize: 30, lineHeight: "38px", fontWeight: 400 }}
          >
            {heading}
          </h1>
          <p style={{ margin: "0 0 26px", fontSize: 16, lineHeight: "26px", color: "#5a4f6e" }}>{body}</p>
          {view.state === "ready" ? (
            <a
              href={view.href}
              rel="noreferrer"
              style={{
                display: "inline-block",
                padding: "16px 26px",
                background: "#4b328e",
                border: "1px solid #4b328e",
                borderRadius: 8,
                color: "#ffffff",
                fontSize: 16,
                lineHeight: "22px",
                fontWeight: 700,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              Open Xpress DJs
            </a>
          ) : null}
          <p
            style={{
              margin: view.state === "ready" ? "28px 0 0" : 0,
              paddingTop: view.state === "ready" ? 22 : 0,
              borderTop: view.state === "ready" ? "1px solid #e4dcf1" : "none",
              color: "#5a4f6e",
              fontSize: 14,
              lineHeight: "23px",
            }}
          >
            If you didn&apos;t request this, you can ignore this email.
          </p>
        </div>
      </section>
    </main>
  );
}
