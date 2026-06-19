"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTrash,
  faPlus,
  faArrowsUpDown,
  faImage,
  faSpinner,
  faCopy,
  faChevronDown,
  faMusic,
  faListCheck,
  faNoteSticky,
  faClock,
  faUserGroup,
  faHeading,
  faFilter,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  updateTemplate,
  setDefaultTemplate,
  deleteTemplate,
  duplicateTemplate,
  addTemplateSection,
  updateTemplateSection,
  deleteTemplateSection,
  reorderTemplateSections,
  addTemplateQuestion,
  updateTemplateQuestion,
  deleteTemplateQuestion,
  uploadOptionImage,
} from "@/app/(app)/settings/planner/actions";

type QOption = string | { label: string; image?: string | null };
export type BuilderQuestion = { id: string; prompt: string; answer_type: string; options: QOption[]; required: boolean; condition_question_id: string | null; condition_values: string[] };
export type BuilderSection = {
  id: string;
  title: string;
  icon: string | null;
  section_type: "info" | "timeline" | "headline";
  intro: string | null;
  guest_enabled: boolean;
  songs_enabled: boolean;
  questions_enabled: boolean;
  notes_enabled: boolean;
  time_enabled: boolean;
  ai_picks_enabled: boolean;
  song_limit: number | null;
  must_play_limit: number | null;
  module: string | null;
  questions: BuilderQuestion[];
};
export type BuilderTemplate = { id: string; name: string; event_type_id: string | null; is_default: boolean };

const ANSWER_TYPES = [
  { value: "short", label: "Short text" },
  { value: "long", label: "Long text" },
  { value: "yesno", label: "Yes / No" },
  { value: "scale", label: "Scale 1–10" },
  { value: "select", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
  { value: "image_select", label: "Photo options (images)" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(ANSWER_TYPES.map((t) => [t.value, t.label]));

export default function TemplateBuilder({
  template,
  sections,
  eventTypes,
}: {
  template: BuilderTemplate;
  sections: BuilderSection[];
  eventTypes: { id: string; name: string }[];
}) {
  const tId = template.id;
  const [, start] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = sections.map((s) => s.id);
  const active = sections.find((s) => s.id === activeId) ?? null;
  const totalQuestions = sections.reduce((n, s) => n + s.questions.length, 0);
  const contentCount = sections.filter((s) => s.section_type !== "headline").length;

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active: a, over } = e;
    if (!over || a.id === over.id) return;
    const from = ids.indexOf(String(a.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    start(() => reorderTemplateSections(tId, arrayMove(ids, from, to)));
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-gradient-to-br from-brand/5 to-transparent dark:border-white/[0.08]">
        <div className="p-6">
          <input
            className="w-full border-0 bg-transparent p-0 text-2xl font-bold text-zinc-900 outline-none placeholder:text-zinc-300 focus:ring-0 dark:text-zinc-50"
            defaultValue={template.name}
            placeholder="Template name"
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== template.name)
                start(() => updateTemplate(tId, { name: e.target.value.trim() }).then(() => undefined));
            }}
          />
          <p className="mt-1 text-sm text-zinc-500">
            {contentCount} section{contentCount === 1 ? "" : "s"} · {totalQuestions} question{totalQuestions === 1 ? "" : "s"}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-white/[0.04]">
              <span className="text-zinc-400">Event type</span>
              <select
                className="border-0 bg-transparent p-0 pr-5 text-sm font-medium text-zinc-700 outline-none focus:ring-0 dark:text-zinc-200"
                defaultValue={template.event_type_id ?? ""}
                onChange={(e) => start(() => updateTemplate(tId, { event_type_id: e.target.value || null }).then(() => undefined))}
              >
                <option value="">Any</option>
                {eventTypes.map((et) => (
                  <option key={et.id} value={et.id}>{et.name}</option>
                ))}
              </select>
            </div>

            <SwitchChip
              label="Default"
              on={template.is_default}
              onChange={(v) => start(() => setDefaultTemplate(tId, v))}
            />

            <div className="flex-1" />

            <button onClick={() => start(() => duplicateTemplate(tId))} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:border-brand hover:text-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
              <FontAwesomeIcon icon={faCopy} /> Duplicate
            </button>
            <button
              onClick={() => { if (confirm("Delete this template?")) start(() => deleteTemplate(tId)); }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-400 transition hover:border-red-300 hover:text-red-500 dark:border-white/10"
              title="Delete template"
            >
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </div>
        </div>
      </div>

      {/* Sections */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-2.5">
            {sections.map((s) => (
              <SortableRow key={s.id} id={s.id}>
                {(handleProps, dragging) => (
                  <SectionCard templateId={tId} section={s} handleProps={handleProps} placeholder={dragging} />
                )}
              </SortableRow>
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {active ? <SectionCard templateId={tId} section={active} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {/* Add */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => start(() => addTemplateSection(tId, { section_type: "timeline" }).then(() => undefined))}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition hover:brightness-110"
        >
          <FontAwesomeIcon icon={faPlus} /> Add section
        </button>
        <button
          onClick={() => start(() => addTemplateSection(tId, { section_type: "headline" }).then(() => undefined))}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-600 transition hover:border-brand hover:text-brand dark:border-white/10 dark:text-zinc-300"
        >
          <FontAwesomeIcon icon={faHeading} /> Add headline
        </button>
      </div>
    </div>
  );
}

function SwitchChip({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        on ? "border-brand bg-brand/10 text-brand dark:text-brand-lighter" : "border-zinc-200 bg-white text-zinc-500 dark:border-white/10 dark:bg-white/[0.04]"
      }`}
    >
      <span className={`relative h-4 w-7 rounded-full transition ${on ? "bg-brand" : "bg-zinc-300 dark:bg-white/20"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-[14px]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: (handleProps: Record<string, unknown>, dragging: boolean) => React.ReactNode;
}) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  );
}

function SectionCard({
  templateId,
  section,
  handleProps,
  placeholder,
  overlay,
}: {
  templateId: string;
  section: BuilderSection;
  handleProps?: Record<string, unknown>;
  placeholder?: boolean;
  overlay?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const isHeadline = section.section_type === "headline";

  const patch = (p: Parameters<typeof updateTemplateSection>[2]) =>
    start(() => updateTemplateSection(templateId, section.id, p).then(() => undefined));

  const Grip = (
    <span
      {...(handleProps ?? {})}
      className="cursor-grab touch-none px-1 text-zinc-300 transition hover:text-brand active:cursor-grabbing dark:text-zinc-600"
      title="Drag to reorder"
    >
      <FontAwesomeIcon icon={faArrowsUpDown} />
    </span>
  );

  const base = "rounded-2xl border transition";
  const tone = isHeadline
    ? "border-zinc-200/80 bg-zinc-50 dark:border-white/[0.06] dark:bg-white/[0.03]"
    : "border-zinc-200 bg-white hover:shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02]";
  const fx = `${placeholder ? "opacity-40 outline-2 outline-dashed outline-brand/50" : ""} ${overlay ? "rotate-1 scale-[1.02] border-brand shadow-2xl ring-2 ring-brand/30" : ""}`;

  return (
    <div className={`group ${base} ${tone} ${fx}`}>
      <div className="flex items-center gap-2 p-3">
        {Grip}
        <div className="flex items-center gap-2 rounded-lg bg-zinc-100 px-2 py-1 dark:bg-white/5">
          <input
            className="w-8 border-0 bg-transparent p-0 text-center text-lg outline-none focus:ring-0"
            defaultValue={section.icon ?? ""}
            placeholder="🎉"
            onBlur={(e) => { if (e.target.value !== (section.icon ?? "")) patch({ icon: e.target.value || null }); }}
          />
        </div>
        <input
          className={`flex-1 border-0 bg-transparent p-0 outline-none focus:ring-0 ${isHeadline ? "text-xs font-bold uppercase tracking-wider text-zinc-500" : "font-semibold text-zinc-800 dark:text-zinc-100"}`}
          defaultValue={section.title}
          onBlur={(e) => { if (e.target.value.trim() && e.target.value !== section.title) patch({ title: e.target.value.trim() }); }}
        />

        {!isHeadline && (
          <div className="hidden items-center gap-1.5 text-[11px] text-zinc-400 sm:flex">
            {section.songs_enabled && <Pill icon={faMusic} text={section.song_limit != null ? `${section.song_limit}` : "songs"} />}
            {section.questions_enabled && section.questions.length > 0 && <Pill icon={faListCheck} text={`${section.questions.length}`} />}
            {section.guest_enabled && <Pill icon={faUserGroup} text="guests" amber />}
          </div>
        )}

        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isHeadline ? "bg-zinc-200 text-zinc-500 dark:bg-white/10" : "bg-brand/10 text-brand dark:text-brand-lighter"}`}>
          {isHeadline ? "Headline" : "Section"}
        </span>

        {!isHeadline && (
          <button
            onClick={() => setOpen((o) => !o)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-brand dark:hover:bg-white/5 ${open ? "rotate-180 text-brand" : ""}`}
            title="Settings"
          >
            <FontAwesomeIcon icon={faChevronDown} />
          </button>
        )}
        <button
          onClick={() => { if (confirm("Delete this section?")) start(() => deleteTemplateSection(templateId, section.id)); }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-500/10"
          title="Delete section"
        >
          <FontAwesomeIcon icon={faTrash} />
        </button>
      </div>

      {open && !isHeadline && (
        <div className="space-y-5 border-t border-zinc-100 p-4 dark:border-white/[0.06]">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Description</label>
            <textarea
              className="input min-h-[56px] w-full text-sm"
              placeholder="Shown at the top of the section for the couple"
              defaultValue={section.intro ?? ""}
              onBlur={(e) => { if (e.target.value !== (section.intro ?? "")) patch({ intro: e.target.value || null }); }}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Special module</label>
            <select
              className="input w-full"
              defaultValue={section.module ?? ""}
              onChange={(e) => patch({ module: e.target.value || null })}
            >
              <option value="">None — standard songs &amp; questions</option>
              <option value="vendors">🤝 Vendor Team (writes to the event&apos;s vendors)</option>
            </select>
            <p className="mt-1 text-xs text-zinc-400">A module replaces the standard section with a purpose-built experience.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Enabled in this section</label>
            <div className="flex flex-wrap gap-2">
              <FeatureToggle icon={faMusic} label="Songs" on={section.songs_enabled} onChange={(v) => patch({ songs_enabled: v })} />
              <FeatureToggle icon={faListCheck} label="Questions" on={section.questions_enabled} onChange={(v) => patch({ questions_enabled: v })} />
              <FeatureToggle icon={faNoteSticky} label="Notes" on={section.notes_enabled} onChange={(v) => patch({ notes_enabled: v })} />
              <FeatureToggle icon={faClock} label="Time" on={section.time_enabled} onChange={(v) => patch({ time_enabled: v })} />
              {section.songs_enabled && <FeatureToggle icon={faWandMagicSparkles} label="For You picks" on={section.ai_picks_enabled} onChange={(v) => patch({ ai_picks_enabled: v })} />}
              <FeatureToggle icon={faUserGroup} label="Guests can answer" on={section.guest_enabled} onChange={(v) => patch({ guest_enabled: v })} amber />
            </div>
          </div>

          {section.songs_enabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField label="Song limit" value={section.song_limit} onSave={(v) => patch({ song_limit: v })} />
              <NumberField label="Must-play limit" value={section.must_play_limit} onSave={(v) => patch({ must_play_limit: v })} />
            </div>
          )}

          {section.questions_enabled && <QuestionEditor templateId={templateId} section={section} />}
        </div>
      )}
    </div>
  );
}

function Pill({ icon, text, amber }: { icon: typeof faMusic; text: string; amber?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${amber ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" : "bg-zinc-100 dark:bg-white/10"}`}>
      <FontAwesomeIcon icon={icon} /> {text}
    </span>
  );
}

function FeatureToggle({ icon, label, on, onChange, amber }: { icon: typeof faMusic; label: string; on: boolean; onChange: (v: boolean) => void; amber?: boolean }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
        on
          ? amber
            ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
            : "border-brand bg-brand/[0.06] text-brand dark:text-brand-lighter"
          : "border-zinc-200 bg-white text-zinc-400 dark:border-white/10 dark:bg-white/[0.03]"
      }`}
    >
      <FontAwesomeIcon icon={icon} className="text-xs" />
      {label}
    </button>
  );
}

function NumberField({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number | null) => void }) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 dark:border-white/10">
      <span className="text-sm text-zinc-600 dark:text-zinc-300">{label}</span>
      <input
        type="number"
        min={0}
        placeholder="∞"
        defaultValue={value ?? ""}
        onBlur={(e) => {
          const v = e.target.value === "" ? null : Number(e.target.value);
          if (v !== value) onSave(v);
        }}
        className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-center text-sm outline-none focus:border-brand dark:border-white/10 dark:bg-white/[0.04]"
      />
    </label>
  );
}

function QuestionEditor({ templateId, section }: { templateId: string; section: BuilderSection }) {
  const [, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [atype, setAtype] = useState("short");
  const [required, setRequired] = useState(false);
  const [textOptions, setTextOptions] = useState("");

  function add() {
    if (!prompt.trim()) return;
    const options = ["select", "multiselect"].includes(atype)
      ? textOptions.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    start(async () => {
      await addTemplateQuestion(templateId, section.id, { prompt: prompt.trim(), answer_type: atype, options, required });
      setPrompt(""); setTextOptions(""); setRequired(false); setAtype("short"); setAdding(false);
    });
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Questions</label>
      <div className="space-y-2">
        {section.questions.map((q) => (
          <QuestionRow key={q.id} templateId={templateId} question={q} siblings={section.questions} />
        ))}
      </div>

      {adding ? (
        <div className="mt-2 space-y-2 rounded-xl border border-brand/40 bg-brand/[0.03] p-3">
          <input className="input w-full" placeholder="Question prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} autoFocus />
          <div className="flex flex-wrap items-center gap-2">
            <select className="input flex-1" value={atype} onChange={(e) => setAtype(e.target.value)}>
              {ANSWER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-4 accent-brand-light" /> Required
            </label>
          </div>
          {["select", "multiselect"].includes(atype) && (
            <input className="input w-full" placeholder="Options, comma-separated" value={textOptions} onChange={(e) => setTextOptions(e.target.value)} />
          )}
          {atype === "image_select" && <p className="text-xs text-zinc-400">Add the photo options after creating the question.</p>}
          <div className="flex gap-2">
            <button onClick={add} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">Add question</button>
            <button onClick={() => setAdding(false)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-brand dark:text-brand-lighter">
          <FontAwesomeIcon icon={faPlus} /> Add question
        </button>
      )}
    </div>
  );
}

function QuestionRow({ templateId, question, siblings }: { templateId: string; question: BuilderQuestion; siblings: BuilderQuestion[] }) {
  const [, start] = useTransition();
  const [condOpen, setCondOpen] = useState(false);
  const isImage = question.answer_type === "image_select";
  const isChoice = ["select", "multiselect"].includes(question.answer_type);
  const hasCond = !!question.condition_question_id;
  const controller = siblings.find((s) => s.id === question.condition_question_id);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex items-start gap-2">
        <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-200">{question.prompt}</span>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-white/10">
          {TYPE_LABEL[question.answer_type] ?? question.answer_type}
        </span>
        {question.required && <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">Required</span>}
        <button
          onClick={() => setCondOpen((o) => !o)}
          className={`shrink-0 transition ${hasCond ? "text-brand dark:text-brand-lighter" : "text-zinc-300 hover:text-brand"}`}
          title="Show-only-if condition"
        >
          <FontAwesomeIcon icon={faFilter} />
        </button>
        <button onClick={() => start(() => deleteTemplateQuestion(templateId, question.id))} className="shrink-0 text-zinc-300 transition hover:text-red-500">
          <FontAwesomeIcon icon={faTrash} />
        </button>
      </div>
      {isChoice && question.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {question.options.map((o, i) => (
            <span key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-white/10">
              {typeof o === "string" ? o : o.label}
            </span>
          ))}
        </div>
      )}
      {hasCond && !condOpen && (
        <p className="mt-2 text-[11px] text-brand dark:text-brand-lighter">
          <FontAwesomeIcon icon={faFilter} className="mr-1" />
          Shows only if “{controller?.prompt ?? "another question"}”{question.condition_values.length ? ` = ${question.condition_values.join(", ")}` : " is answered"}
        </p>
      )}
      {condOpen && (
        <ConditionEditor templateId={templateId} question={question} siblings={siblings} onClose={() => setCondOpen(false)} />
      )}
      {isImage && <ImageOptions templateId={templateId} question={question} />}
    </div>
  );
}

function ConditionEditor({
  templateId,
  question,
  siblings,
  onClose,
}: {
  templateId: string;
  question: BuilderQuestion;
  siblings: BuilderQuestion[];
  onClose: () => void;
}) {
  const [, start] = useTransition();
  const others = siblings.filter((s) => s.id !== question.id);
  const [ctrlId, setCtrlId] = useState(question.condition_question_id ?? "");
  const [values, setValues] = useState((question.condition_values ?? []).join(", "));
  const ctrl = others.find((s) => s.id === ctrlId);
  const ctrlOptions = ctrl ? ctrl.options.map((o) => (typeof o === "string" ? o : o.label)) : [];

  function save() {
    const vals = values.split(",").map((v) => v.trim()).filter(Boolean);
    start(() => updateTemplateQuestion(templateId, question.id, {
      condition_question_id: ctrlId || null,
      condition_values: ctrlId ? vals : [],
    }).then(() => onClose()));
  }
  function clear() {
    start(() => updateTemplateQuestion(templateId, question.id, { condition_question_id: null, condition_values: [] }).then(() => onClose()));
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-brand/30 bg-brand/[0.03] p-3">
      <p className="text-xs font-semibold text-brand dark:text-brand-lighter">Show this question only if…</p>
      <select className="input w-full" value={ctrlId} onChange={(e) => setCtrlId(e.target.value)}>
        <option value="">Always show</option>
        {others.map((s) => (
          <option key={s.id} value={s.id}>{s.prompt}</option>
        ))}
      </select>
      {ctrlId && (
        <>
          <input
            className="input w-full"
            placeholder={ctrlOptions.length ? `e.g. ${ctrlOptions.slice(0, 2).join(", ")}` : "answer value(s), comma-separated — blank = any answer"}
            value={values}
            onChange={(e) => setValues(e.target.value)}
          />
          {ctrlOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ctrlOptions.map((o) => (
                <button
                  key={o}
                  onClick={() => {
                    const set = new Set(values.split(",").map((v) => v.trim()).filter(Boolean));
                    if (set.has(o)) set.delete(o); else set.add(o);
                    setValues(Array.from(set).join(", "));
                  }}
                  className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 hover:border-brand dark:border-white/10 dark:text-zinc-300"
                >
                  {o}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="flex gap-2">
        <button onClick={save} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">Save</button>
        {question.condition_question_id && <button onClick={clear} className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 hover:text-red-500">Remove condition</button>}
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800">Cancel</button>
      </div>
    </div>
  );
}

function ImageOptions({ templateId, question }: { templateId: string; question: BuilderQuestion }) {
  const [, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const options = (question.options as { label: string; image?: string | null }[]) ?? [];

  function persist(next: QOption[]) {
    start(() => updateTemplateQuestion(templateId, question.id, { options: next }).then(() => undefined));
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("photo", file);
    const res = await uploadOptionImage(fd);
    setBusy(false);
    e.target.value = "";
    if (res.ok && res.url) {
      persist([...options, { label: label.trim() || `Option ${options.length + 1}`, image: res.url }]);
      setLabel("");
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/[0.03]">
      <div className="flex flex-wrap gap-3">
        {options.map((o, i) => (
          <div key={i} className="relative w-24">
            {o.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.image} alt={o.label} className="h-24 w-24 rounded-xl object-cover shadow-sm" />
            )}
            <p className="mt-1 truncate text-center text-[11px] text-zinc-600 dark:text-zinc-300">{o.label}</p>
            <button onClick={() => persist(options.filter((_, idx) => idx !== i))} className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow">
              <FontAwesomeIcon icon={faTrash} className="text-[9px]" />
            </button>
          </div>
        ))}
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-zinc-300 text-zinc-400 transition hover:border-brand hover:text-brand dark:border-white/15"
        >
          <FontAwesomeIcon icon={busy ? faSpinner : faImage} className={busy ? "animate-spin" : "text-lg"} />
          <span className="text-[10px] font-medium">{busy ? "Uploading…" : "Add photo"}</span>
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      <input
        className="mt-3 w-48 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand dark:border-white/10 dark:bg-white/[0.04]"
        placeholder="Label for next photo"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
    </div>
  );
}
