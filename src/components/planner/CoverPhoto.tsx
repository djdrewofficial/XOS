"use client";

import { useRef, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCamera, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { uploadEventPhoto, removeEventPhoto } from "@/app/portal/plan/[eventId]/actions";

/* Couple-uploaded event cover. Renders the brand gradient when empty; hosts/staff
   get a camera button to upload or change it. */
export default function CoverPhoto({
  eventId,
  url,
  canEdit,
  children,
}: {
  eventId: string;
  url: string | null;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    setError(null);
    start(async () => {
      const res = await uploadEventPhoto(eventId, fd);
      if (!res?.ok) setError(res?.error || "Upload failed");
    });
    e.target.value = "";
  }

  return (
    <div className="relative h-60 w-full overflow-hidden rounded-3xl md:h-72">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-brand via-brand-light to-brand-lighter" />
      )}
      {/* darkening overlay for legible text */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/10" />

      {canEdit && (
        <>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-lg backdrop-blur transition hover:bg-white disabled:opacity-60"
          >
            <FontAwesomeIcon icon={pending ? faSpinner : faCamera} className={pending ? "animate-spin" : ""} />
            {url ? "Change photo" : "Add photo"}
          </button>
          {url && (
            <button
              onClick={() => start(() => removeEventPhoto(eventId).then(() => undefined))}
              disabled={pending}
              className="absolute right-4 top-16 z-10 rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white backdrop-blur transition hover:bg-black/60"
            >
              Remove
            </button>
          )}
        </>
      )}

      {error && (
        <p className="absolute left-4 top-4 z-10 rounded-lg bg-red-600/90 px-3 py-1.5 text-xs text-white">
          {error}
        </p>
      )}

      {/* overlaid content (title/date/progress) */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-6 md:p-8">{children}</div>
    </div>
  );
}
