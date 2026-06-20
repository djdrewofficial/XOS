"use client";

import { useRef, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faUpload, faEye, faEyeSlash, faArrowUp, faArrowDown, faPen, faCheck } from "@fortawesome/free-solid-svg-icons";
import { uploadBackdrop, updateBackdrop, toggleBackdrop, deleteBackdrop, reorderBackdrops } from "./actions";

export type Backdrop = {
  id: string;
  name: string;
  category: string | null;
  image_url: string;
  is_active: boolean;
  sort_order: number;
};

export default function BackdropManager({ backdrops }: { backdrops: Backdrop[] }) {
  const [items, setItems] = useState<Backdrop[]>(backdrops);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");

  function submitUpload(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr("Choose an image first.");
    const fd = new FormData();
    fd.set("photo", file);
    fd.set("name", name);
    fd.set("category", category);
    start(async () => {
      const res = await uploadBackdrop(fd);
      if (!res.ok) return setErr(res.error || "Upload failed");
      setName("");
      setCategory("");
      if (fileRef.current) fileRef.current.value = "";
      // Server revalidate refreshes the list; mirror optimistically too.
      window.location.reload();
    });
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[idx], next[j]] = [next[j], next[idx]];
    setItems(next);
    start(() => reorderBackdrops(next.map((b) => b.id)));
  }

  return (
    <div className="space-y-6">
      {/* Upload */}
      <form onSubmit={submitUpload} className="card flex flex-wrap items-end gap-3 p-5">
        <div className="flex-1 min-w-50">
          <label className="mb-1 block text-xs font-medium text-zinc-500">Image</label>
          <input ref={fileRef} type="file" accept="image/*" className="block w-full text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold Sequin" className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Category (optional)</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Glam" className="input" />
        </div>
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
          <FontAwesomeIcon icon={faUpload} className="mr-2" />
          {pending ? "Uploading…" : "Add Backdrop"}
        </button>
        {err && <p className="w-full text-sm text-red-500">{err}</p>}
      </form>

      {/* Gallery */}
      {items.length === 0 ? (
        <p className="card p-8 text-center text-sm text-zinc-400">No backdrops yet — upload your first one above.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((b, i) => (
            <BackdropCard
              key={b.id}
              b={b}
              first={i === 0}
              last={i === items.length - 1}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onToggle={(active) => { setItems((p) => p.map((x) => (x.id === b.id ? { ...x, is_active: active } : x))); start(() => toggleBackdrop(b.id, active)); }}
              onRename={(name, category) => { setItems((p) => p.map((x) => (x.id === b.id ? { ...x, name, category } : x))); start(() => { updateBackdrop(b.id, { name, category }); }); }}
              onDelete={() => { if (confirm("Delete this backdrop?")) { setItems((p) => p.filter((x) => x.id !== b.id)); start(() => deleteBackdrop(b.id)); } }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BackdropCard({
  b,
  first,
  last,
  onMoveUp,
  onMoveDown,
  onToggle,
  onRename,
  onDelete,
}: {
  b: Backdrop;
  first: boolean;
  last: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: (active: boolean) => void;
  onRename: (name: string, category: string | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(b.name);
  const [category, setCategory] = useState(b.category ?? "");

  return (
    <div className={`card overflow-hidden ${b.is_active ? "" : "opacity-60"}`}>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={b.image_url} alt={b.name} className="h-48 w-full object-cover" />
        {!b.is_active && (
          <span className="absolute left-2 top-2 rounded-full bg-zinc-900/70 px-2 py-0.5 text-[10px] font-semibold text-white">Hidden</span>
        )}
      </div>
      <div className="p-3">
        {editing ? (
          <div className="space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full text-sm" placeholder="Name" />
            <input value={category} onChange={(e) => setCategory(e.target.value)} className="input w-full text-sm" placeholder="Category" />
            <button
              onClick={() => { onRename(name.trim() || "Backdrop", category.trim() || null); setEditing(false); }}
              className="btn-primary w-full py-1.5 text-sm"
            >
              <FontAwesomeIcon icon={faCheck} className="mr-1" /> Save
            </button>
          </div>
        ) : (
          <>
            <p className="truncate font-semibold text-zinc-800 dark:text-zinc-100">{b.name}</p>
            {b.category && <p className="truncate text-xs text-zinc-400">{b.category}</p>}
          </>
        )}

        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-1">
            <IconBtn icon={faArrowUp} disabled={first} onClick={onMoveUp} title="Move up" />
            <IconBtn icon={faArrowDown} disabled={last} onClick={onMoveDown} title="Move down" />
          </div>
          <div className="flex gap-1">
            <IconBtn icon={editing ? faCheck : faPen} onClick={() => setEditing((e) => !e)} title="Rename" />
            <IconBtn
              icon={b.is_active ? faEye : faEyeSlash}
              onClick={() => onToggle(!b.is_active)}
              title={b.is_active ? "Hide from couples" : "Show to couples"}
            />
            <IconBtn icon={faTrash} onClick={onDelete} title="Delete" danger />
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  icon,
  onClick,
  disabled,
  title,
  danger,
}: {
  icon: typeof faPen;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-white/5 ${
        danger ? "hover:text-red-500" : "hover:text-brand"
      }`}
    >
      <FontAwesomeIcon icon={icon} />
    </button>
  );
}
