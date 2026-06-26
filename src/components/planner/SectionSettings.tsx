"use client";

import { useRef, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faTrash, faPlus, faPen, faImage, faSpinner } from "@fortawesome/free-solid-svg-icons";
import type { PlanningSection, QuestionOption } from "@/lib/planning";
import {
  updateSectionSettings,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  uploadSectionCover,
} from "@/app/portal/plan/[eventId]/actions";

const PERM_ACTIONS: { key: string; label: string }[] = [
  { key: "delete", label: "Who can delete this section" },
  { key: "rename", label: "Who can rename this section" },
  { key: "cover", label: "Who can modify cover photo" },
  { key: "reorder_songs", label: "Who can reorder songs" },
  { key: "edit_notes", label: "Who can view & edit notes" },
  { key: "change_time", label: "Who can change time" },
];

// Client-safe option label (can't import value helpers from the server-only planning module).
const optLabel = (o: QuestionOption): string => (typeof o === "string" ? o : o.label);

const ANSWER_TYPES = [
  { value: "short", label: "Short text" },
  { value: "long", label: "Long text" },
  { value: "yesno", label: "Yes / No" },
  { value: "scale", label: "Scale 1–10" },
  { value: "select", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
];

export default function SectionSettings({
  eventId,
  section,
  onClose,
}: {
  eventId: string;
  section: PlanningSection;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Local editable state
  const [type, setType] = useState<"timeline" | "headline">(section.section_type === "headline" ? "headline" : "timeline");
  const [title, setTitle] = useState(section.title);
  const [icon, setIcon] = useState(section.icon ?? "");
  const [intro, setIntro] = useState(section.intro ?? "");
  const [guestEnabled, setGuestEnabled] = useState(section.guest_enabled);
  const [songsOn, setSongsOn] = useState(section.songs_enabled);
  const [songLimit, setSongLimit] = useState(section.song_limit?.toString() ?? "");
  const [mustPlayLimit, setMustPlayLimit] = useState(section.must_play_limit?.toString() ?? "");
  const [questionsOn, setQuestionsOn] = useState(section.questions_enabled);
  const [notesOn, setNotesOn] = useState(section.notes_enabled);
  const [timeOn, setTimeOn] = useState(section.time_enabled);
  const [timeLabel, setTimeLabel] = useState(section.time_label ?? "");
  // Whether this section appears on the couple's app timeline. Default follows the
  // type (timeline=on, info=off) until explicitly set here.
  const [onTimeline, setOnTimeline] = useState(section.on_timeline ?? section.section_type === "timeline");
  // Whether this section appears on the couple's Music tab (vibe curation).
  // Default: open playlists (songs on + no single-song limit).
  const [onMusic, setOnMusic] = useState(section.on_music ?? (section.songs_enabled && section.song_limit == null));

  const initialPerms: Record<string, boolean> = {};
  for (const a of PERM_ACTIONS) {
    const roles = section.permissions?.[a.key] ?? ["dj", "host"];
    initialPerms[a.key] = roles.includes("host");
  }
  const [perms, setPerms] = useState(initialPerms);
  const [confirming, setConfirming] = useState(false);

  // Unsaved-changes detection (the question editor + cover upload save on their
  // own, so they're intentionally not part of this).
  const dirty =
    type !== (section.section_type === "headline" ? "headline" : "timeline") ||
    title !== section.title ||
    icon !== (section.icon ?? "") ||
    intro !== (section.intro ?? "") ||
    guestEnabled !== section.guest_enabled ||
    songsOn !== section.songs_enabled ||
    songLimit !== (section.song_limit?.toString() ?? "") ||
    mustPlayLimit !== (section.must_play_limit?.toString() ?? "") ||
    questionsOn !== section.questions_enabled ||
    notesOn !== section.notes_enabled ||
    timeOn !== section.time_enabled ||
    timeLabel !== (section.time_label ?? "") ||
    onTimeline !== (section.on_timeline ?? section.section_type === "timeline") ||
    onMusic !== (section.on_music ?? (section.songs_enabled && section.song_limit == null)) ||
    JSON.stringify(perms) !== JSON.stringify(initialPerms);

  function requestClose() {
    if (dirty) setConfirming(true);
    else onClose();
  }

  function save() {
    setErr(null);
    const permissions: Record<string, string[]> = {};
    for (const a of PERM_ACTIONS) permissions[a.key] = perms[a.key] ? ["dj", "host"] : ["dj"];
    start(async () => {
      const res = await updateSectionSettings(eventId, section.id, {
        section_type: type,
        title: title.trim() || "Untitled",
        icon: icon.trim() || null,
        intro: intro.trim() || null,
        guest_enabled: guestEnabled,
        songs_enabled: songsOn,
        song_limit: songLimit === "" ? null : Number(songLimit),
        must_play_limit: mustPlayLimit === "" ? null : Number(mustPlayLimit),
        questions_enabled: questionsOn,
        notes_enabled: notesOn,
        time_enabled: timeOn,
        time_label: timeLabel.trim() || null,
        on_timeline: onTimeline,
        on_music: onMusic,
        permissions,
      });
      if (res?.ok) onClose();
      else setErr(res?.error || "Could not save");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="relative my-8 flex max-h-[calc(100vh-4rem)] w-full max-w-none flex-col rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        {/* Header (sticky) */}
        <div className="flex shrink-0 items-center justify-between rounded-t-2xl border-b border-zinc-200 bg-white px-6 py-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            Section settings — {section.icon} {section.title}
          </h2>
          <button onClick={requestClose} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Type */}
          <Group label="Type">
            <div className="flex gap-2">
              <TypeBtn active={type === "timeline"} onClick={() => setType("timeline")} label="Section" />
              <TypeBtn active={type === "headline"} onClick={() => setType("headline")} label="Headline" />
            </div>
          </Group>

          {/* General */}
          <Group label="General">
            <div className="space-y-3">
              <div className="flex gap-2">
                <input className="input w-16 text-center" placeholder="🎉" value={icon} onChange={(e) => setIcon(e.target.value)} />
                <input className="input flex-1" placeholder="Section name" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              {type !== "headline" && (
                <textarea className="input min-h-[64px] w-full" placeholder="Description" value={intro} onChange={(e) => setIntro(e.target.value)} />
              )}
              <CoverUpload eventId={eventId} sectionId={section.id} url={section.section_cover_url} />
            </div>
          </Group>

          {/* Permissions */}
          <Group label="Permissions">
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-xs text-zinc-500">Who will see this section</p>
                <div className="flex gap-2">
                  <RolePill active label="DJ" locked />
                  <RolePill active label="Host" locked />
                  <RolePill active={guestEnabled} label="Guest" onClick={() => setGuestEnabled((v) => !v)} />
                </div>
              </div>
              {PERM_ACTIONS.map((a) => (
                <div key={a.key}>
                  <p className="mb-1.5 text-xs text-zinc-500">{a.label}</p>
                  <div className="flex gap-2">
                    <RolePill active label="DJ" locked />
                    <RolePill active={perms[a.key]} label="Host" onClick={() => setPerms((p) => ({ ...p, [a.key]: !p[a.key] }))} />
                  </div>
                </div>
              ))}
            </div>
          </Group>

          {type !== "headline" && (
            <>
              {/* Songs */}
              <Group label="Songs">
                <ToggleRow label="Songs on" on={songsOn} onToggle={() => setSongsOn((v) => !v)} />
                {songsOn && (
                  <div className="mt-3 space-y-3">
                    <NumberRow label="Song limit" value={songLimit} onChange={setSongLimit} placeholder="∞" />
                    <NumberRow label="Must-play limit" value={mustPlayLimit} onChange={setMustPlayLimit} placeholder="∞" />
                    <ToggleRow label="Show on Music tab (vibe curation)" on={onMusic} onToggle={() => setOnMusic((v) => !v)} />
                    <p className="text-xs text-zinc-500">
                      Surfaces this section on the couple&apos;s Music tab for playlist/vibe curation (e.g. Cocktail Hour, Dinner, Open Dancing). Turn off for single-song moments.
                    </p>
                  </div>
                )}
              </Group>

              {/* Questions */}
              <Group label="Questions">
                <ToggleRow label="Questions on" on={questionsOn} onToggle={() => setQuestionsOn((v) => !v)} />
                {questionsOn && <QuestionEditor eventId={eventId} section={section} />}
              </Group>

              {/* Notes */}
              <Group label="Notes">
                <ToggleRow label="Notes on" on={notesOn} onToggle={() => setNotesOn((v) => !v)} />
              </Group>

              {/* Time */}
              <Group label="Time">
                <ToggleRow label="Time on" on={timeOn} onToggle={() => setTimeOn((v) => !v)} />
                {timeOn && (
                  <input className="input mt-3 w-40" placeholder="05:00 pm" value={timeLabel} onChange={(e) => setTimeLabel(e.target.value)} />
                )}
              </Group>

              {/* Client timeline visibility */}
              <Group label="Client timeline">
                <ToggleRow label="Show on couple's timeline" on={onTimeline} onToggle={() => setOnTimeline((v) => !v)} />
                <p className="mt-2 text-xs text-zinc-500">
                  Turn off for informational sections (e.g. Vendor Team) that belong in the plan but not on the couple&apos;s event timeline.
                </p>
              </Group>
            </>
          )}

          {err && <p className="text-sm text-red-500">{err}</p>}
        </div>

        {/* Footer (sticky) */}
        <div className="flex shrink-0 items-center justify-end gap-2 rounded-b-2xl border-t border-zinc-200 bg-white px-6 py-4 dark:border-white/10 dark:bg-zinc-900">
          {dirty && <span className="mr-auto text-xs font-medium text-amber-600 dark:text-amber-400">Unsaved changes</span>}
          <button onClick={requestClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={pending || !dirty} className="btn-primary disabled:opacity-50">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>

        {/* Unsaved-changes guard */}
        {confirming && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">Unsaved changes</h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                You&apos;ve made changes to this section. Do you want to save them before closing?
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button onClick={() => setConfirming(false)} className="btn-ghost">Keep editing</button>
                <button onClick={() => { setConfirming(false); onClose(); }} className="btn-ghost text-red-500 hover:text-red-600">Discard</button>
                <button onClick={() => { setConfirming(false); save(); }} disabled={pending} className="btn-primary disabled:opacity-50">Save changes</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">{label}</h3>
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">{children}</div>
    </div>
  );
}

function TypeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition ${
        active ? "border-brand bg-brand text-white" : "border-zinc-300 text-zinc-600 dark:border-white/10 dark:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}

function RolePill({ active, label, onClick, locked }: { active: boolean; label: string; onClick?: () => void; locked?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={locked}
      className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition ${
        active ? "border-brand bg-brand/10 text-brand dark:text-brand-lighter" : "border-zinc-300 text-zinc-400 dark:border-white/10"
      } ${locked ? "cursor-default opacity-90" : ""}`}
    >
      {label}
    </button>
  );
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
      <button onClick={onToggle} className={`relative h-6 w-11 rounded-full transition ${on ? "bg-brand" : "bg-zinc-300 dark:bg-white/20"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

function NumberRow({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-zinc-600 dark:text-zinc-300">{label}</span>
      <input
        type="number"
        min={0}
        className="input w-20 text-center"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function CoverUpload({ eventId, sectionId, url }: { eventId: string; sectionId: string; url: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    start(() => uploadSectionCover(eventId, sectionId, fd).then(() => undefined));
    e.target.value = "";
  }
  return (
    <div className="flex items-center gap-3">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-12 w-20 rounded-lg object-cover" />
      )}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={pick} />
      <button onClick={() => ref.current?.click()} disabled={pending} className="inline-flex items-center gap-2 text-sm font-semibold text-brand dark:text-brand-lighter">
        <FontAwesomeIcon icon={pending ? faSpinner : faImage} className={pending ? "animate-spin" : ""} />
        {url ? "Change section cover" : "Add section cover"}
      </button>
    </div>
  );
}

function QuestionEditor({ eventId, section }: { eventId: string; section: PlanningSection }) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"none" | "add" | string>("none"); // "add" or a question id
  const [prompt, setPrompt] = useState("");
  const [help, setHelp] = useState("");
  const [atype, setAtype] = useState("short");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");

  const reset = () => {
    setMode("none"); setPrompt(""); setHelp(""); setAtype("short"); setRequired(false); setOptions("");
  };
  const beginAdd = () => {
    setMode("add"); setPrompt(""); setHelp(""); setAtype("short"); setRequired(false); setOptions("");
  };
  const beginEdit = (q: PlanningSection["questions"][number]) => {
    setMode(q.id);
    setPrompt(q.prompt);
    setHelp(q.help_text ?? "");
    setAtype(q.answer_type);
    setRequired(q.required);
    setOptions(q.options.map(optLabel).join(", "));
  };

  function save() {
    if (!prompt.trim()) return;
    // Manage options only for the option-based types; leave others untouched so
    // image/branching option data isn't wiped on edit.
    let opts: string[] | undefined;
    if (["select", "multiselect"].includes(atype)) opts = options.split(",").map((s) => s.trim()).filter(Boolean);
    else if (["short", "long", "yesno", "scale"].includes(atype)) opts = [];
    const payload = { prompt: prompt.trim(), help_text: help.trim() || undefined, answer_type: atype, options: opts, required };
    start(async () => {
      if (mode === "add") await addQuestion(eventId, section.id, payload);
      else await updateQuestion(eventId, mode, payload);
      reset();
    });
  }

  // Preserve unusual types (e.g. image_select) in the dropdown when editing.
  const typeOptions = ANSWER_TYPES.some((t) => t.value === atype) ? ANSWER_TYPES : [...ANSWER_TYPES, { value: atype, label: atype }];

  return (
    <div className="mt-3 space-y-2">
      <ul className="space-y-1.5">
        {section.questions.map((q) => (
          <li key={q.id} className="rounded-lg border border-zinc-200 dark:border-white/10">
            <div className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block text-zinc-700 dark:text-zinc-200">{q.prompt}</span>
                {q.help_text && <span className="mt-0.5 block text-xs text-zinc-400">{q.help_text}</span>}
              </span>
              <span className="shrink-0 text-xs text-zinc-400">{q.answer_type}</span>
              <button onClick={() => beginEdit(q)} disabled={pending} className="shrink-0 text-zinc-400 hover:text-brand" title="Edit question">
                <FontAwesomeIcon icon={faPen} />
              </button>
              <button onClick={() => start(() => deleteQuestion(eventId, q.id))} disabled={pending} className="shrink-0 text-zinc-400 hover:text-red-500" title="Delete question">
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </div>
            {mode === q.id && (
              <QuestionForm
                prompt={prompt} setPrompt={setPrompt} help={help} setHelp={setHelp}
                atype={atype} setAtype={setAtype} required={required} setRequired={setRequired}
                options={options} setOptions={setOptions} typeOptions={typeOptions}
                pending={pending} onSave={save} onCancel={reset} saveLabel="Save changes"
              />
            )}
          </li>
        ))}
      </ul>

      {mode === "add" ? (
        <QuestionForm
          prompt={prompt} setPrompt={setPrompt} help={help} setHelp={setHelp}
          atype={atype} setAtype={setAtype} required={required} setRequired={setRequired}
          options={options} setOptions={setOptions} typeOptions={typeOptions}
          pending={pending} onSave={save} onCancel={reset} saveLabel="Add question"
        />
      ) : mode === "none" ? (
        <button onClick={beginAdd} className="inline-flex items-center gap-2 text-sm font-semibold text-brand dark:text-brand-lighter">
          <FontAwesomeIcon icon={faPlus} /> Add question
        </button>
      ) : null}
    </div>
  );
}

function QuestionForm({
  prompt, setPrompt, help, setHelp, atype, setAtype, required, setRequired, options, setOptions,
  typeOptions, pending, onSave, onCancel, saveLabel,
}: {
  prompt: string; setPrompt: (v: string) => void;
  help: string; setHelp: (v: string) => void;
  atype: string; setAtype: (v: string) => void;
  required: boolean; setRequired: (v: boolean) => void;
  options: string; setOptions: (v: string) => void;
  typeOptions: { value: string; label: string }[];
  pending: boolean; onSave: () => void; onCancel: () => void; saveLabel: string;
}) {
  return (
    <div className="space-y-2 border-t border-zinc-200 p-3 dark:border-white/10">
      <input className="input w-full" placeholder="Question prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <textarea
        className="input w-full"
        rows={2}
        placeholder="Description (optional) — e.g. “Why are we asking this?”"
        value={help}
        onChange={(e) => setHelp(e.target.value)}
      />
      <div className="flex gap-2">
        <select className="input flex-1" value={atype} onChange={(e) => setAtype(e.target.value)}>
          {typeOptions.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
      </div>
      {["select", "multiselect"].includes(atype) && (
        <input className="input w-full" placeholder="Options, comma-separated" value={options} onChange={(e) => setOptions(e.target.value)} />
      )}
      <div className="flex gap-2">
        <button onClick={onSave} disabled={pending} className="btn-primary disabled:opacity-50">{saveLabel}</button>
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
      </div>
    </div>
  );
}
