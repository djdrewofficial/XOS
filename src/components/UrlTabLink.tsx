"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

/* Child of <Link> so useLinkStatus can see this navigation. A tab click used to
   look frozen while the server rebuilt the event page. */
function TabPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      className="ml-1.5 inline-block size-3 animate-spin rounded-full border-2 border-current/30 border-t-current align-[-1px]"
      aria-hidden
    />
  );
}

export default function UrlTabLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} scroll={false} prefetch={false} className={className}>
      {children}
      <TabPending />
    </Link>
  );
}
