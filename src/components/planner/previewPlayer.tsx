"use client";

import { useState, useSyncExternalStore } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlay, faPause, faSpinner } from "@fortawesome/free-solid-svg-icons";

/* One shared <audio> for the whole planner so only one preview plays at a time.
   Tiny external store broadcasts the currently-playing id to every button. */
let audio: HTMLAudioElement | null = null;
let currentId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("ended", () => { currentId = null; emit(); });
  }
  return audio;
}

async function toggle(id: string, resolveUrl: () => Promise<string | null>): Promise<boolean> {
  const a = ensureAudio();
  if (currentId === id) { a.pause(); currentId = null; emit(); return true; }
  const url = await resolveUrl();
  if (!url) { return false; }
  a.src = url;
  currentId = id;
  emit();
  try {
    await a.play();
  } catch {
    currentId = null;
    emit();
  }
  return true;
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export function usePreviewCurrent(): string | null {
  return useSyncExternalStore(subscribe, () => currentId, () => null);
}

export function PreviewButton({
  id,
  title,
  artist,
  previewUrl,
  className,
  size = "md",
}: {
  id: string;
  title: string;
  artist: string | null;
  previewUrl?: string | null;
  className?: string;
  size?: "sm" | "md";
}) {
  const current = usePreviewCurrent();
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const playing = current === id;

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMissing(false);
    const ok = await toggle(id, async () => {
      if (previewUrl) return previewUrl;
      setLoading(true);
      try {
        const r = await fetch(`/api/music/preview?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist ?? "")}`);
        const j = (await r.json()) as { url: string | null };
        return j.url;
      } catch {
        return null;
      } finally {
        setLoading(false);
      }
    });
    if (!ok) setMissing(true);
  }

  const dim = size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  return (
    <button
      onClick={onClick}
      title={missing ? "No preview available" : playing ? "Pause" : "Preview"}
      className={
        className ??
        `flex ${dim} items-center justify-center rounded-full bg-white/90 text-zinc-800 shadow transition hover:scale-110 ${missing ? "opacity-50" : ""}`
      }
    >
      <FontAwesomeIcon icon={loading ? faSpinner : playing ? faPause : faPlay} className={loading ? "animate-spin" : playing ? "" : "ml-0.5"} />
    </button>
  );
}
