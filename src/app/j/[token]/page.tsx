import type { Metadata } from "next";
import { describeJoinLink } from "@/lib/eventAccessServer";
import CopyLinkButton from "./CopyLinkButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Join your event",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f1fb] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#e4ddf7] bg-white p-6 shadow-xl sm:p-8">{children}</div>
    </div>
  );
}

export default async function JoinLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await describeJoinLink(token);

  if (!link.ok) {
    return (
      <Shell>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#4b328e]">Xpress Entertainment</p>
        <h1 className="mt-3 text-xl font-bold text-zinc-900">This link doesn&apos;t work</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">Ask the couple or your DJ for a new one.</p>
      </Shell>
    );
  }

  const line =
    link.role === "host"
      ? "Open the app to join as a host. You and your planners can see the whole event."
      : "Open the app to join as a guest. You will see the parts the couple or DJ opened for guests.";

  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#4b328e]">Xpress Entertainment</p>
      <h1 className="mt-3 text-2xl font-bold text-zinc-900">{link.eventName}</h1>
      <p className="mt-2 text-sm leading-6 text-zinc-600">{line}</p>

      <a
        href={link.schemeUrl}
        className="mt-5 block rounded-xl bg-gradient-to-r from-[#4b328e] to-[#8b6fd6] px-4 py-3 text-center text-sm font-bold text-white"
      >
        Open in the app
      </a>
      {link.storeUrl ? (
        <a
          href={link.storeUrl}
          className="mt-2 block rounded-xl border border-[#d9d0f0] px-4 py-3 text-center text-sm font-semibold text-[#4b328e]"
        >
          Get the app
        </a>
      ) : (
        <p className="mt-3 text-center text-sm text-zinc-500">Search the App Store for Xpress Entertainment.</p>
      )}

      {link.code && (
        <div className="mt-6 text-center">
          <p className="text-xs text-zinc-500">If the app asks for a code, type this in.</p>
          <p className="mt-2 font-mono text-3xl font-extrabold tracking-[0.18em] text-[#4b328e]">{link.code}</p>
        </div>
      )}

      <CopyLinkButton url={link.pageUrl} />
    </Shell>
  );
}
