"use client";

import { useEffect, useState } from "react";

/* Shows the right Vibo download button for the visitor's device first, with the
   others below. URLs come from Settings → Client Journey. */

type Device = "ios" | "android" | "web";

export default function ViboDownload({
  iosUrl,
  androidUrl,
  webUrl,
}: {
  iosUrl: string | null;
  androidUrl: string | null;
  webUrl: string | null;
}) {
  const [device, setDevice] = useState<Device>("web");
  useEffect(() => {
    const ua = navigator.userAgent || "";
    if (/iphone|ipad|ipod/i.test(ua)) setDevice("ios");
    else if (/android/i.test(ua)) setDevice("android");
    else setDevice("web");
  }, []);

  const all: { key: Device; label: string; url: string | null }[] = [
    { key: "ios", label: "Download for iPhone", url: iosUrl },
    { key: "android", label: "Download for Android", url: androidUrl },
    { key: "web", label: "Open Vibo in your browser", url: webUrl },
  ];
  const available = all.filter((b) => b.url);
  if (available.length === 0) return null;

  const primary = available.find((b) => b.key === device) ?? available[0];
  const others = available.filter((b) => b.key !== primary.key);

  return (
    <div className="space-y-2">
      <a
        href={primary.url!}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full rounded-xl bg-gradient-to-r from-brand to-brand-light px-4 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110"
      >
        {primary.label}
      </a>
      {others.length > 0 && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          {others.map((b) => (
            <a key={b.key} href={b.url!} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-500 underline hover:text-brand">
              {b.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
