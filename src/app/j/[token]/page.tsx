import type { Metadata } from "next";
import { DM_Serif_Display, Montserrat } from "next/font/google";
import { describeJoinLink } from "@/lib/eventAccessServer";
import CopyLinkButton from "./CopyLinkButton";

/* Public landing for couple-app join links (/j/<token>). Opens
   xpressclient://j/<token> or the App Store. Match the auth/reset bridge
   brand: purple header, logo, red accent, DM Serif + Montserrat. */

const display = DM_Serif_Display({ weight: "400", subsets: ["latin"], display: "swap" });
const sans = Montserrat({ weight: ["400", "600", "700"], subsets: ["latin"], display: "swap" });

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Join your event",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className={sans.className}
      style={{
        minHeight: "100vh",
        background: "linear-gradient(165deg, #2a1a52 0%, #4b328e 42%, #6a4db8 100%)",
        color: "#120c1e",
        padding: "20px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#ffffff",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 18px 40px rgba(18, 12, 30, 0.28)",
        }}
      >
        <div style={{ background: "#4b328e", padding: "22px 24px", textAlign: "center" }}>
          <img
            src="/logo-dark.png"
            alt="Xpress Entertainment"
            width={200}
            height={88}
            style={{ display: "inline-block", width: 200, maxWidth: "72%", height: "auto" }}
          />
        </div>
        <div style={{ height: 4, background: "#fe3a3b" }} />
        <div style={{ padding: "22px 20px 20px" }}>
          <style>{`
            a.join-primary:hover { background: #fe3a3b !important; border-color: #fe3a3b !important; }
            a.join-outline:hover { border-color: #fe3a3b !important; color: #fe3a3b !important; }
          `}</style>
          {children}
        </div>
      </section>
    </main>
  );
}

export default async function JoinLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await describeJoinLink(token);

  if (!link.ok) {
    return (
      <Shell>
        <h1
          className={display.className}
          style={{ margin: 0, color: "#4b328e", fontSize: 26, lineHeight: "32px", fontWeight: 400 }}
        >
          This link doesn&apos;t work
        </h1>
        <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: "24px", color: "#5a4f6e" }}>
          Ask the couple or your DJ for a new one.
        </p>
      </Shell>
    );
  }

  const line =
    link.role === "host"
      ? "Open the app to join as a host. You and your planners can see the whole event."
      : "Open the app to join as a guest. You will see the parts the couple or DJ opened for guests.";

  return (
    <Shell>
      <h1
        className={display.className}
        style={{ margin: 0, color: "#4b328e", fontSize: 28, lineHeight: "34px", fontWeight: 400 }}
      >
        {link.eventName}
      </h1>
      <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: "24px", color: "#5a4f6e" }}>{line}</p>

      <a
        className="join-primary"
        href={link.schemeUrl}
        rel="noreferrer"
        style={{
          display: "block",
          marginTop: 18,
          padding: "13px 18px",
          background: "#4b328e",
          border: "1px solid #4b328e",
          borderRadius: 8,
          color: "#ffffff",
          fontSize: 15,
          lineHeight: "22px",
          fontWeight: 700,
          textAlign: "center",
          textDecoration: "none",
        }}
      >
        Open in the app
      </a>
      {link.storeUrl ? (
        <a
          className="join-outline"
          href={link.storeUrl}
          rel="noreferrer"
          style={{
            display: "block",
            marginTop: 8,
            padding: "12px 18px",
            background: "#ffffff",
            border: "1.5px solid #4b328e",
            borderRadius: 8,
            color: "#4b328e",
            fontSize: 15,
            lineHeight: "22px",
            fontWeight: 700,
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Get the app
        </a>
      ) : (
        <p style={{ margin: "12px 0 0", textAlign: "center", fontSize: 14, lineHeight: "22px", color: "#5a4f6e" }}>
          Search the App Store for Xpress Entertainment.
        </p>
      )}

      {link.code && (
        <div style={{ marginTop: 22, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: "#5a4f6e" }}>
            If the app asks for a code, type this in.
          </p>
          <p
            style={{
              margin: "8px 0 0",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "#4b328e",
            }}
          >
            {link.code}
          </p>
        </div>
      )}

      <CopyLinkButton url={link.pageUrl} />
    </Shell>
  );
}
