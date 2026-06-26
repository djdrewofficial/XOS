"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInstagram, faTiktok } from "@fortawesome/free-brands-svg-icons";
import { saveSocialHandles } from "@/app/portal/social-actions";

export type SocialState = {
  should_show: boolean;
  instagram: string | null;
  tiktok: string | null;
  company_instagram: string | null;
  company_tiktok: string | null;
};

const clean = (s: string) => s.trim().replace(/^@+/, "");

export default function SocialPrompt({ state }: { state: SocialState | null }) {
  const [show, setShow] = useState(!!state?.should_show);
  const [step, setStep] = useState<1 | 2>(1);
  const [ig, setIg] = useState(state?.instagram ?? "");
  const [tt, setTt] = useState(state?.tiktok ?? "");
  const [busy, setBusy] = useState(false);

  if (!show || !state) return null;
  const hasFollow = !!(state.company_instagram || state.company_tiktok);

  const resolve = async (skip: boolean) => {
    setBusy(true);
    await saveSocialHandles(skip ? null : clean(ig) || null, skip ? null : clean(tt) || null);
    setBusy(false);
    if (hasFollow) setStep(2);
    else setShow(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-2xl dark:bg-zinc-900">
        {step === 1 ? (
          <>
            <div className="text-4xl">📸</div>
            <h2 className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">Let&apos;s connect!</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Share your Instagram &amp; TikTok so we can tag you and feature your big day.</p>

            <div className="mt-5 space-y-2.5 text-left">
              <Field label="Instagram" icon={faInstagram} value={ig} onChange={setIg} />
              <Field label="TikTok" icon={faTiktok} value={tt} onChange={setTt} />
            </div>

            <button onClick={() => resolve(false)} disabled={busy} className="btn-primary mt-5 w-full disabled:opacity-60">
              {busy ? "Saving…" : "Save"}
            </button>
            <button onClick={() => resolve(true)} disabled={busy} className="mt-3 text-sm font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              I don&apos;t have these
            </button>
          </>
        ) : (
          <>
            <div className="text-4xl">✨</div>
            <h2 className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">Follow along!</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Follow us for inspo, real weddings, and behind-the-scenes.</p>

            <div className="mt-5 space-y-2.5">
              {state.company_instagram && (
                <a href={state.company_instagram} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 py-3 font-semibold text-zinc-800 hover:border-brand dark:border-white/10 dark:text-zinc-100">
                  <FontAwesomeIcon icon={faInstagram} /> Follow on Instagram
                </a>
              )}
              {state.company_tiktok && (
                <a href={state.company_tiktok} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 py-3 font-semibold text-zinc-800 hover:border-brand dark:border-white/10 dark:text-zinc-100">
                  <FontAwesomeIcon icon={faTiktok} /> Follow on TikTok
                </a>
              )}
            </div>

            <button onClick={() => setShow(false)} className="btn-primary mt-5 w-full">Done</button>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, icon, value, onChange }: { label: string; icon: typeof faInstagram; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 dark:border-white/10">
      <FontAwesomeIcon icon={icon} className="text-zinc-400" />
      <span className="w-20 text-sm font-semibold text-zinc-500">{label}</span>
      <span className="text-zinc-400">@</span>
      <input
        value={value.replace(/^@+/, "")}
        onChange={(e) => onChange(e.target.value)}
        placeholder="yourhandle"
        autoCapitalize="none"
        className="flex-1 bg-transparent py-2.5 text-sm text-zinc-900 outline-none dark:text-zinc-100"
      />
    </div>
  );
}
