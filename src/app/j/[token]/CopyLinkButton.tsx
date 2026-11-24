"use client";

import { useState } from "react";

export default function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ marginTop: 18 }}>
      <label
        htmlFor="join-link"
        style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600, color: "#5a4f6e" }}
      >
        Link
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          id="join-link"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            minWidth: 0,
            flex: 1,
            borderRadius: 8,
            border: "1px solid #e4dcf1",
            background: "#f8f5fc",
            padding: "10px 12px",
            fontSize: 12,
            lineHeight: "18px",
            color: "#3a3150",
          }}
        />
        <button
          type="button"
          style={{
            flexShrink: 0,
            borderRadius: 8,
            border: "1px solid #4b328e",
            background: "#4b328e",
            padding: "10px 14px",
            fontSize: 12,
            fontWeight: 700,
            color: "#ffffff",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#fe3a3b";
            e.currentTarget.style.borderColor = "#fe3a3b";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#4b328e";
            e.currentTarget.style.borderColor = "#4b328e";
          }}
          onClick={() => {
            void navigator.clipboard.writeText(url).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              },
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: "18px", color: "#5a4f6e" }}>
        After you install the app, it can read this link from your clipboard.
      </p>
    </div>
  );
}
