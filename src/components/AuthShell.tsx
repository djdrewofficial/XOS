import type { ReactNode } from "react";

/* Shared frame for the public auth screens (sign in, forgot password, set
   password) so they all sit on the same photo and card. */
export default function AuthShell({
  subtitle,
  children,
}: {
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-zinc-900 bg-cover bg-center p-4"
      style={{ backgroundImage: "url(/login-bg.jpg)" }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/75" />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/20 bg-white/95 p-8 shadow-2xl backdrop-blur-md dark:bg-zinc-900/90">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Xpress Entertainment" className="mx-auto mb-2 block w-56 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Xpress Entertainment" className="mx-auto mb-2 hidden w-56 dark:block" />
        <p className="mb-8 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-600">
          {subtitle}
        </p>
        {children}
      </div>
    </div>
  );
}
