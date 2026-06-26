"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHeart as faHeartSolid,
  faTrash,
  faCheckCircle,
  faNoteSticky,
  faListCheck,
  faUsers,
  faUserGroup,
  faLock,
  faGear,
  faStar as faStarSolid,
  faArrowsUpDown,
  faRotateLeft,
  faClockRotateLeft,
  faArrowRight,
  faArrowLeft,
  faWandMagicSparkles,
  faTableCells,
  faRoute,
  faChevronDown,
  faChevronUp,
  faClock,
} from "@fortawesome/free-solid-svg-icons";
import { faHeart as faHeartOutline, faCircle, faStar as faStarOutline } from "@fortawesome/free-regular-svg-icons";
import { faSpotify } from "@fortawesome/free-brands-svg-icons";
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
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  EventPlanning,
  PlanningSection,
  PlanningSong,
  PlanningQuestion,
  PlannerRole,
  Person,
  SectionPermissions,
  QuestionOption,
  EventVendor,
} from "@/lib/planning";
import MusicSearch from "@/components/planner/MusicSearch";
import CoverPhoto from "@/components/planner/CoverPhoto";
import PeoplePanel from "@/components/planner/PeoplePanel";
import SectionSettings from "@/components/planner/SectionSettings";
import VendorTeamModule from "@/components/planner/VendorTeamModule";
import PhotoBoothModule from "@/components/planner/PhotoBoothModule";
import SpotifyImport from "@/components/planner/SpotifyImport";
import { PreviewButton } from "@/components/planner/previewPlayer";
import {
  saveAnswer,
  addSong,
  removeSong,
  updateSongNote,
  reorderSongs,
  toggleLike,
  toggleMustPlay,
  setSectionGuestAccess,
  setSectionTime,
  reorderSections,
  deleteSection,
  restoreSection,
  addSection,
  addLibrarySection,
  listLibrarySections,
  disablePlaylistSync,
  type LibrarySectionOption,
} from "@/app/portal/plan/[eventId]/actions";
import { faPlus } from "@fortawesome/free-solid-svg-icons";

// Client-safe permission check (mirrors planning.permAllows; can't import the
// server-only module's value exports into a client component).
function allows(perms: SectionPermissions, action: string, role: PlannerRole): boolean {
  if (role === "staff") return true;
  const roles = perms?.[action] ?? ["dj", "host"];
  return role === "host" ? roles.includes("host") : false;
}

const optLabel = (o: QuestionOption): string => (typeof o === "string" ? o : o.label);
const optImage = (o: QuestionOption): string | null => (typeof o === "string" ? null : o.image ?? null);

// Client-side mirror of planning.questionVisible (server-only module can't be
// imported here). Show a conditional question only when its controller matches.
function qVisible(q: PlanningQuestion, answers: Record<string, string>): boolean {
  if (!q.condition_question_id) return true;
  const ctrl = answers[q.condition_question_id];
  if (ctrl == null) return true;
  if (q.condition_values.length === 0) return ctrl.trim() !== "";
  const parts = ctrl.split("|");
  return q.condition_values.some((v) => parts.includes(v) || ctrl === v);
}

export default function Planner({
  eventId,
  eventName,
  eventDate,
  coverPhotoUrl,
  planning,
  people,
  vendors,
  role,
}: {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  coverPhotoUrl: string | null;
  planning: EventPlanning;
  people: { hosts: Person[]; guests: Person[] };
  vendors: EventVendor[];
  role: PlannerRole;
}) {
  const isGuest = role === "guest";
  const isStaff = role === "staff";
  const canEditCover = isStaff || role === "host";

  const [tab, setTab] = useState<"plan" | "people" | "activity">("plan");
  // The couple gets the guided journey by default; staff preview opens flat.
  const [mode, setMode] = useState<"guided" | "all">(role === "staff" ? "all" : "guided");
  // Default to the first real section, not a headline divider (which has no page).
  const [selectedId, setSelectedId] = useState<string | null>(planning.sections.find((s) => s.section_type !== "headline")?.id ?? null);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // Local order for optimistic drag reorder; resync when server data changes.
  const [order, setOrder] = useState<PlanningSection[]>(planning.sections);
  useEffect(() => setOrder(planning.sections), [planning.sections]);

  // Section Templates library for the staff "Add Section" picker (loaded once).
  const [libraryOptions, setLibraryOptions] = useState<LibrarySectionOption[]>([]);
  useEffect(() => {
    if (isStaff) listLibrarySections(eventId).then(setLibraryOptions).catch(() => {});
  }, [isStaff, eventId]);

  // Remember the open section across refreshes via ?s=<id> (post-mount to avoid
  // a hydration mismatch). selectSection keeps the URL in sync as you navigate.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("s");
    if (s && planning.sections.some((x) => x.id === s)) setSelectedId(s);
  }, [planning.sections]);
  function selectSection(id: string) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("s", id);
    window.history.replaceState(null, "", url.toString());
  }

  // Re-pull on tab focus (throttled) so live-synced songs and other changes show
  // up without a manual reload. router.refresh re-runs the server page, which
  // also triggers the throttled sync-on-open.
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 20_000) {
        last = Date.now();
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);

  const sections = order;
  // Never resolve to a headline — it has no detail page (blank). Fall back to the first real section.
  const firstContent = sections.find((s) => s.section_type !== "headline") ?? null;
  const picked = sections.find((s) => s.id === selectedId) ?? null;
  const selected = picked && picked.section_type !== "headline" ? picked : firstContent;
  const settingsSection = planning.sections.find((s) => s.id === settingsId) ?? null;

  // Guided journey steps: skip headlines (used as group labels) and any section
  // with nothing to do. Each step carries the group it belongs to.
  let lastGroup: string | null = null;
  const guidedSteps: (PlanningSection & { group: string | null })[] = [];
  for (const s of sections) {
    if (s.section_type === "headline") { lastGroup = s.title; continue; }
    const hasContent = !!s.module || s.songs_enabled || s.questions.length > 0;
    if (hasContent) guidedSteps.push({ ...s, group: lastGroup });
  }
  const onPlanArea = isGuest || tab === "plan";

  const qPct = pct(planning.answeredQuestions, planning.totalQuestions);
  const sPct = pct(planning.filledSongSlots, planning.totalSongSlots);

  const dateLabel = eventDate
    ? new Date(eventDate + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <CoverPhoto eventId={eventId} url={coverPhotoUrl} canEdit={canEditCover}>
        {dateLabel && <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/80">{dateLabel}</p>}
        <h1 className="text-3xl font-bold text-white drop-shadow md:text-4xl">{eventName}</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <HeroChip icon={faListCheck} label={`${planning.answeredQuestions}/${planning.totalQuestions} questions`} pct={qPct} />
          {!isGuest && planning.totalSongSlots > 0 && (
            <HeroChip icon={faHeartSolid} label={`${planning.filledSongSlots}/${planning.totalSongSlots} key songs`} pct={sPct} />
          )}
        </div>
      </CoverPhoto>

      {!isGuest && (
        <div className="mt-6 flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-white/[0.04]">
          <TabButton active={tab === "plan"} onClick={() => setTab("plan")} icon={faListCheck} label="Plan" />
          <TabButton
            active={tab === "people"}
            onClick={() => setTab("people")}
            icon={faUsers}
            label={`People · ${people.hosts.length + people.guests.length}`}
          />
          {isStaff && (
            <TabButton active={tab === "activity"} onClick={() => setTab("activity")} icon={faClockRotateLeft} label="Activity" />
          )}
        </div>
      )}

      {isGuest && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          <FontAwesomeIcon icon={faUserGroup} className="mr-2" />
          You&apos;ve been invited to help with a few questions for this event. Thanks for pitching in!
        </div>
      )}

      {onPlanArea && sections.length > 0 && (
        <div className="mt-4 flex justify-end">
          <div className="inline-flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-white/[0.04]">
            <ModeBtn active={mode === "guided"} onClick={() => setMode("guided")} icon={faRoute} label="Guided" />
            <ModeBtn active={mode === "all"} onClick={() => setMode("all")} icon={faTableCells} label="All sections" />
          </div>
        </div>
      )}

      <div className="mt-6">
        {!isGuest && tab === "people" ? (
          <PeoplePanel eventId={eventId} hosts={people.hosts} guests={people.guests} canManage={isStaff || role === "host"} />
        ) : !isGuest && tab === "activity" ? (
          <ActivityLog entries={planning.auditLog} />
        ) : sections.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-white/[0.08] dark:bg-white/[0.02]">
            {isGuest ? "Nothing to fill out just yet — check back soon!" : isStaff ? "No planning sections yet." : "Your DJ is still setting things up — check back soon!"}
          </div>
        ) : mode === "guided" ? (
          <GuidedFlow eventId={eventId} steps={guidedSteps} role={role} vendors={vendors} onSeeAll={() => setMode("all")} />
        ) : isGuest ? (
          <div className="space-y-5">
            {sections.map((s) => (
              <SectionDetail key={s.id} eventId={eventId} section={s} role={role} vendors={vendors} />
            ))}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            <aside className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin]">
              <SectionList
                sections={sections}
                selectedId={selected?.id ?? null}
                role={role}
                libraryOptions={libraryOptions}
                onSelect={selectSection}
                onSettings={(id) => setSettingsId(id)}
                onReorder={(next) => {
                  setOrder(next);
                  reorderSections(eventId, next.map((s) => s.id));
                }}
                onDelete={(id) => deleteSection(eventId, id)}
                onInsert={async (afterSortOrder, input) => {
                  const res = await addSection(eventId, afterSortOrder, input);
                  if (res?.ok && isStaff && res.id) {
                    selectSection(res.id);
                    setSettingsId(res.id); // open settings so staff can finish setup
                  }
                }}
                onInsertTemplate={async (afterSortOrder, templateSectionId) => {
                  const res = await addLibrarySection(eventId, afterSortOrder, templateSectionId);
                  if (res?.ok && res.id) selectSection(res.id);
                }}
              />
              {isStaff && planning.hostDeletedSections.length > 0 && (
                <HostDeletedSections eventId={eventId} sections={planning.hostDeletedSections} />
              )}
            </aside>
            <main>{selected && <SectionDetail key={selected.id} eventId={eventId} section={selected} role={role} vendors={vendors} />}</main>
          </div>
        )}
      </div>

      {settingsSection && (
        <SectionSettings eventId={eventId} section={settingsSection} onClose={() => setSettingsId(null)} />
      )}
    </div>
  );
}

function pct(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

function HeroChip({ icon, label, pct }: { icon: typeof faListCheck; label: string; pct: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
      <FontAwesomeIcon icon={icon} />
      {label}
      <span className="ml-0.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px]">{pct}%</span>
    </span>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: typeof faListCheck; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
        active ? "bg-white text-brand shadow-sm dark:bg-white/10 dark:text-brand-lighter" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
    >
      <FontAwesomeIcon icon={icon} />
      {label}
    </button>
  );
}

// ───────────────────────── Section list (drag reorder) ─────────────────────────

function SectionList({
  sections,
  selectedId,
  role,
  libraryOptions,
  onSelect,
  onSettings,
  onReorder,
  onDelete,
  onInsert,
  onInsertTemplate,
}: {
  sections: PlanningSection[];
  selectedId: string | null;
  role: PlannerRole;
  libraryOptions: LibrarySectionOption[];
  onSelect: (id: string) => void;
  onSettings: (id: string) => void;
  onReorder: (next: PlanningSection[]) => void;
  onDelete: (id: string) => void;
  onInsert: (afterSortOrder: number, input?: { title?: string; icon?: string }) => void | Promise<unknown>;
  onInsertTemplate: (afterSortOrder: number, templateSectionId: string) => void | Promise<unknown>;
}) {
  const canReorder = role === "staff" || role === "host";
  const canAdd = role === "staff" || role === "host";
  const [activeId, setActiveId] = useState<string | null>(null);

  // Drag starts only after a small move so plain clicks still select. Pointer
  // sensor covers mouse + touch; keyboard sensor keeps it accessible.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!canReorder) {
    return (
      <div className="space-y-2">
        {sections.map((s) => (
          <SectionCard
            key={s.id}
            section={s}
            active={s.id === selectedId}
            role={role}
            canReorder={false}
            onClick={() => onSelect(s.id)}
            onSettings={() => onSettings(s.id)}
            onDelete={() => onDelete(s.id)}
          />
        ))}
      </div>
    );
  }

  const ids = sections.map((s) => s.id);
  const active = sections.find((s) => s.id === activeId) ?? null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active: a, over } = e;
    if (!over || a.id === over.id) return;
    const from = ids.indexOf(String(a.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(sections, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {canAdd && (
          <InsertBar
            disabled={!!activeId}
            onAdd={(input) => onInsert(-1, input)}
            libraryOptions={libraryOptions}
            onAddTemplate={(tid) => onInsertTemplate(-1, tid)}
          />
        )}
        {sections.map((s) => (
          <Fragment key={s.id}>
            <SortableSection id={s.id}>
              {(handleProps, dragging) => (
                <SectionCard
                  section={s}
                  active={s.id === selectedId}
                  role={role}
                  canReorder
                  handleProps={handleProps}
                  placeholder={dragging}
                  onClick={() => onSelect(s.id)}
                  onSettings={() => onSettings(s.id)}
                  onDelete={() => onDelete(s.id)}
                />
              )}
            </SortableSection>
            {canAdd && (
              <InsertBar
                disabled={!!activeId}
                onAdd={(input) => onInsert(s.sort_order, input)}
                libraryOptions={libraryOptions}
                onAddTemplate={(tid) => onInsertTemplate(s.sort_order, tid)}
              />
            )}
          </Fragment>
        ))}
      </SortableContext>

      {/* The lifted clone that follows the cursor. */}
      <DragOverlay>
        {active ? (
          <SectionCard
            section={active}
            active={active.id === selectedId}
            role={role}
            canReorder
            overlay
            onClick={() => {}}
            onSettings={() => {}}
            onDelete={() => {}}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Sortable wrapper: applies the live shift transform + exposes drag-handle
    props. While dragging, its in-place slot becomes a dashed drop placeholder. */
function SortableSection({
  id,
  children,
}: {
  id: string;
  children: (handleProps: Record<string, unknown>, dragging: boolean) => React.ReactNode;
}) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  );
}

/** The "+" insertion control that lives between section cards (Vibo-style).
    Always occupies a small fixed gap so the list spacing stays constant; while a
    drag is in progress it's just an inert spacer. */
function InsertBar({
  onAdd,
  onAddTemplate,
  libraryOptions,
  disabled,
}: {
  onAdd: (input?: { title?: string; icon?: string }) => void | Promise<unknown>;
  onAddTemplate: (templateSectionId: string) => void | Promise<unknown>;
  libraryOptions: LibrarySectionOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [pending, start] = useTransition();

  function add() {
    start(async () => {
      await onAdd({ title: title.trim() || undefined, icon: icon.trim() || undefined });
      setOpen(false);
      setTitle("");
      setIcon("");
    });
  }

  function addTemplate(id: string) {
    start(async () => {
      await onAddTemplate(id);
      setOpen(false);
    });
  }

  if (open) {
    return (
      <div className="my-1.5 rounded-xl border border-brand/40 bg-brand/[0.03] p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-lighter">New section</p>
        <div className="flex gap-2">
          <input className="input w-14 text-center" placeholder="🎉" value={icon} onChange={(e) => setIcon(e.target.value)} />
          <input
            autoFocus
            className="input flex-1"
            placeholder="Section name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") setOpen(false);
            }}
          />
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={add} disabled={pending} className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50">
            {pending ? "Adding…" : "Add blank section"}
          </button>
          <button onClick={() => setOpen(false)} className="btn-ghost px-3 py-1.5 text-sm">Cancel</button>
        </div>

        {libraryOptions.length > 0 && (
          <div className="mt-3 border-t border-brand/15 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">From Section Templates</p>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {libraryOptions.map((o) => (
                <button
                  key={o.id}
                  onClick={() => addTemplate(o.id)}
                  disabled={pending}
                  className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition hover:border-brand hover:bg-brand/[0.04] disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.02]"
                >
                  <span className="text-base">{o.icon || "📄"}</span>
                  <span className="flex-1 truncate font-medium text-zinc-800 dark:text-zinc-100">{o.title}</span>
                  {o.module && (
                    <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand dark:text-brand-lighter">{o.module}</span>
                  )}
                  {o.question_count > 0 && <span className="text-xs text-zinc-400">{o.question_count} Q</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Inert spacer during drag (keeps gaps from collapsing as cards animate).
  if (disabled) return <div className="h-2" aria-hidden />;

  return (
    <div className="group relative flex h-2 items-center justify-center">
      {/* invisible taller hit area so the thin line is easy to hover */}
      <span className="absolute inset-x-0 -inset-y-2" />
      <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-brand/30 opacity-0 transition group-hover:opacity-100" />
      <button
        onClick={() => setOpen(true)}
        className="relative z-10 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] text-white opacity-0 shadow transition hover:scale-125 group-hover:opacity-100"
        title="Add a section here"
      >
        <FontAwesomeIcon icon={faPlus} />
      </button>
    </div>
  );
}

function SectionCard({
  section,
  active,
  role,
  canReorder,
  handleProps,
  placeholder,
  overlay,
  onClick,
  onSettings,
  onDelete,
}: {
  section: PlanningSection;
  active: boolean;
  role: PlannerRole;
  canReorder: boolean;
  handleProps?: Record<string, unknown>;
  placeholder?: boolean; // this slot is the drop target while its card is lifted
  overlay?: boolean; // rendered in the DragOverlay (the floating clone)
  onClick: () => void;
  onSettings: () => void;
  onDelete: () => void;
}) {
  const [pending, start] = useTransition();
  const qDone = section.answered_count;
  const qTotal = section.questions.length;
  const complete = qTotal > 0 && qDone === qTotal;
  const isStaff = role === "staff";
  const canDelete = allows(section.permissions, "delete", role);

  const Grip = canReorder ? (
    <span
      {...(handleProps ?? {})}
      className="cursor-grab touch-none text-sm text-zinc-300 opacity-40 transition hover:text-brand group-hover:opacity-100 active:cursor-grabbing dark:text-zinc-600"
      onClick={(e) => e.stopPropagation()}
      title="Drag to reorder"
    >
      <FontAwesomeIcon icon={faArrowsUpDown} />
    </span>
  ) : null;

  if (section.section_type === "headline") {
    return (
      <div
        className={`group flex items-center gap-2 rounded-lg px-2 pb-1 pt-3 ${
          placeholder ? "opacity-40 outline-2 outline-dashed outline-brand/50" : ""
        } ${overlay ? "bg-white shadow-2xl ring-2 ring-brand dark:bg-zinc-900" : ""}`}
      >
        {Grip}
        {/* Headlines are group dividers — not navigable (they have no detail page). */}
        <span className="flex-1 text-left text-xs font-bold uppercase tracking-wider text-zinc-400">
          {section.icon} {section.title}
        </span>
        {isStaff && (
          <button onClick={onSettings} className="text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-brand">
            <FontAwesomeIcon icon={faGear} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`group w-full rounded-2xl border p-4 transition ${
        active ? "border-brand bg-brand/[0.04] shadow-sm dark:border-brand-light/60 dark:bg-brand/10" : "border-zinc-200 bg-white hover:border-brand/40 hover:shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02]"
      } ${placeholder ? "opacity-40 outline-2 outline-dashed outline-brand/60" : ""} ${
        overlay ? "rotate-1 scale-[1.03] cursor-grabbing border-brand shadow-2xl ring-2 ring-brand/30" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {Grip}
        <button onClick={onClick} className="flex flex-1 items-center justify-between gap-2 text-left">
          <span className="flex items-center gap-2 font-semibold text-zinc-800 dark:text-zinc-100">
            {section.icon && <span className="text-lg">{section.icon}</span>}
            {section.title}
          </span>
          {section.time_label && <span className="shrink-0 text-xs text-zinc-400">{section.time_label}</span>}
        </button>
        <div className="flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100">
          {isStaff && (
            <button onClick={onSettings} className="text-zinc-300 hover:text-brand" title="Section settings">
              <FontAwesomeIcon icon={faGear} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => {
                if (confirm(role === "staff" ? "Permanently delete this section?" : "Remove this section?")) start(() => onDelete());
              }}
              disabled={pending}
              className="text-zinc-300 hover:text-red-500"
              title={role === "staff" ? "Delete section" : "Remove section"}
            >
              <FontAwesomeIcon icon={faTrash} />
            </button>
          )}
        </div>
      </div>
      <button onClick={onClick} className="mt-2 flex w-full flex-wrap items-center gap-2 text-left text-xs">
        {section.songs_enabled && (
          <span className="chip">
            🎵 {section.songs.length}
            {section.song_limit != null ? `/${section.song_limit}` : ""}
          </span>
        )}
        {qTotal > 0 && (
          <span className="chip">
            <FontAwesomeIcon icon={complete ? faCheckCircle : faCircle} className={complete ? "text-green-500" : "text-zinc-400"} />
            {qDone}/{qTotal}
          </span>
        )}
        {(isStaff || role === "host") && section.guest_enabled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
            <FontAwesomeIcon icon={faUserGroup} /> Guests
          </span>
        )}
      </button>
    </div>
  );
}

function HostDeletedSections({ eventId, sections }: { eventId: string; sections: PlanningSection[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-zinc-300 p-3 dark:border-white/10">
      <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-zinc-400">Host Deleted Sections</p>
      <ul className="space-y-1.5">
        {sections.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-white/10">
            <span className="flex-1 text-zinc-500">
              {s.icon} {s.title}
              {s.deleted_by_host_name && <span className="block text-xs text-zinc-400">removed by {s.deleted_by_host_name}</span>}
            </span>
            <button onClick={() => start(() => restoreSection(eventId, s.id))} disabled={pending} className="text-zinc-400 hover:text-brand" title="Restore">
              <FontAwesomeIcon icon={faRotateLeft} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivityLog({ entries }: { entries: EventPlanning["auditLog"] }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-brand dark:text-brand-lighter">
        <FontAwesomeIcon icon={faClockRotateLeft} /> Activity
      </h3>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">Every change to this planner — staff only.</p>
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-400">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 border-b border-zinc-100 pb-2 text-sm last:border-0 dark:border-white/[0.04]">
              <span className="mt-0.5 shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-white/10">{e.actor_role}</span>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-zinc-800 dark:text-zinc-100">{e.actor_name}</span>{" "}
                <span className="text-zinc-600 dark:text-zinc-300">{e.action.toLowerCase()}</span>
                {e.detail && <span className="text-zinc-500"> — {e.detail}</span>}
              </div>
              <time className="shrink-0 text-xs text-zinc-400">
                {new Date(e.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Inline time editor for time-enabled sections — sits top-left of the header.
function SectionTimeEditor({ eventId, sectionId, value, canEdit }: { eventId: string; sectionId: string; value: string | null; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  if (!canEdit) {
    return value ? (
      <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
        <FontAwesomeIcon icon={faClock} /> {value}
      </div>
    ) : null;
  }

  if (editing) {
    const save = (v: string | null) => start(async () => { await setSectionTime(eventId, sectionId, v); setEditing(false); });
    return (
      <div className="mb-2 flex items-center gap-2">
        <FontAwesomeIcon icon={faClock} className="text-zinc-400" />
        <input
          autoFocus
          className="input w-32 py-1 text-sm"
          placeholder="5:00 PM"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(draft); if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); } }}
        />
        <button onClick={() => save(draft)} disabled={pending} className="btn-primary px-3 py-1 text-xs disabled:opacity-50">Save</button>
        {value && <button onClick={() => save(null)} disabled={pending} className="text-xs text-zinc-400 hover:text-red-500">Clear</button>}
        <button onClick={() => { setDraft(value ?? ""); setEditing(false); }} className="text-xs text-zinc-400 hover:text-zinc-600">Cancel</button>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className={`mb-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold transition ${
        value
          ? "border-brand/30 bg-brand/5 text-brand dark:text-brand-lighter"
          : "border-dashed border-zinc-300 text-zinc-400 hover:border-brand hover:text-brand dark:border-white/15"
      }`}
      title="Edit section time"
    >
      <FontAwesomeIcon icon={faClock} /> {value || "Add a time"}
    </button>
  );
}

// ───────────────────────────── Section detail ─────────────────────────────

function SectionDetail({ eventId, section, role, vendors }: { eventId: string; section: PlanningSection; role: PlannerRole; vendors: EventVendor[] }) {
  const isStaff = role === "staff";
  const isGuest = role === "guest";
  // Live answer map drives conditional question visibility (re-inits per section
  // since SectionDetail is keyed by section id).
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const q of section.questions) m[q.id] = q.answer ?? "";
    return m;
  });
  const isPhotoBooth = section.module === "photobooth";
  const canEditSongs =
    section.songs_enabled &&
    !isGuest &&
    (isStaff || (role === "host" && section.client_editable && !section.locked));
  // Photo Booth is a special module — its own layout replaces songs + questions.
  const showSongs = !isPhotoBooth && section.songs_enabled && !isGuest && section.section_type !== "headline";
  const showQuestions = !isPhotoBooth && section.questions_enabled && section.questions.length >= 0;
  const atLimit = section.song_limit != null && section.songs.length >= section.song_limit;
  const mustPlayFull = section.must_play_limit != null && section.must_play_count >= section.must_play_limit;
  const canMustPlay = !isGuest && (isStaff || role === "host");
  // Long song lists show a short preview with a prominent "show all" expander so
  // they don't bury the questions. songsOpen = show the full (scroll-capped) list.
  const [songsOpen, setSongsOpen] = useState(false);
  const SONG_PREVIEW = 4;

  if (section.section_type === "headline") {
    return (
      <div className="flex items-center gap-3 py-2">
        <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">
          {section.icon} {section.title}
        </h2>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02]">
      {section.section_cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={section.section_cover_url} alt="" className="h-32 w-full object-cover md:h-40" />
      )}
      <div className="p-6 md:p-7">
        {section.time_enabled && (
          <SectionTimeEditor
            eventId={eventId}
            sectionId={section.id}
            value={section.time_label}
            canEdit={!isGuest && allows(section.permissions, "change_time", role)}
          />
        )}
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {section.icon && <span className="mr-2">{section.icon}</span>}
            {section.title}
          </h2>
          {section.locked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
              <FontAwesomeIcon icon={faLock} /> Locked
            </span>
          )}
        </div>
        {section.intro && <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">{section.intro}</p>}

        {isStaff && (
          <label className="mb-5 flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-white/10 dark:text-zinc-300">
            <GuestToggle eventId={eventId} sectionId={section.id} enabled={section.guest_enabled} />
            <FontAwesomeIcon icon={faUserGroup} className="text-amber-500" /> Let invited guests answer this section
          </label>
        )}

        {section.module === "vendors" && (
          <VendorTeamModule eventId={eventId} vendors={vendors} canEdit={isStaff || role === "host"} />
        )}

        {isPhotoBooth && <PhotoBoothModule eventId={eventId} canEdit={isStaff || role === "host"} isStaff={isStaff} />}

        {/* Questions first — they never get buried under a long playlist. */}
        {showQuestions && section.questions.length > 0 && (
          <section className="mb-6">
            {showSongs && (
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-brand dark:text-brand-lighter">
                Questions <span className="text-zinc-400">{section.answered_count}/{section.questions.length}</span>
              </h3>
            )}
            <div className="space-y-5">
              {section.questions
                .filter((q) => qVisible(q, answers))
                .map((q) => (
                  <QuestionField
                    key={q.id}
                    eventId={eventId}
                    question={q}
                    value={answers[q.id] ?? ""}
                    onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                  />
                ))}
            </div>
          </section>
        )}

        {showSongs && section.spotify_sync_playlist_name && (
          <SpotifySyncBanner
            eventId={eventId}
            sectionId={section.id}
            playlistName={section.spotify_sync_playlist_name}
            syncedAt={section.spotify_synced_at}
            canEdit={canEditSongs}
          />
        )}

        {/* Songs — preview a few; prominent expander reveals the rest (scroll-capped). */}
        {showSongs && (
          <section>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-brand dark:text-brand-lighter">
              Songs <span className="text-zinc-400">{section.songs.length}{section.song_limit != null ? `/${section.song_limit}` : ""}</span>
              {section.must_play_limit != null && (
                <span className="ml-2 text-zinc-400">· {section.must_play_count}/{section.must_play_limit} must-play</span>
              )}
            </h3>

            {section.songs.length === 0 && (
              <p className="mb-3 rounded-xl border border-dashed border-zinc-300 p-5 text-center text-sm text-zinc-400 dark:border-white/10">No songs yet.</p>
            )}

            <ul className={`space-y-2 ${songsOpen ? "max-h-[28rem] overflow-y-auto pr-1 [scrollbar-width:thin]" : ""}`}>
              {(songsOpen ? section.songs : section.songs.slice(0, SONG_PREVIEW)).map((song, i) => (
                <SongRow
                  key={song.id}
                  eventId={eventId}
                  song={song}
                  index={i}
                  total={section.songs.length}
                  orderedIds={section.songs.map((s) => s.id)}
                  sectionId={section.id}
                  canEdit={canEditSongs}
                  canMustPlay={canMustPlay}
                  mustPlayFull={mustPlayFull}
                  showWhoAdded={isStaff || role === "host"}
                />
              ))}
            </ul>

            {section.songs.length > SONG_PREVIEW && (
              <button
                onClick={() => setSongsOpen((o) => !o)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-brand/40 bg-brand/[0.04] py-2.5 text-sm font-bold text-brand transition hover:bg-brand/10 dark:border-brand-light/40 dark:text-brand-lighter"
              >
                {songsOpen ? (
                  <>Show fewer <FontAwesomeIcon icon={faChevronUp} /></>
                ) : (
                  <>Show all {section.songs.length} songs <FontAwesomeIcon icon={faChevronDown} /></>
                )}
              </button>
            )}

            {canEditSongs && !atLimit && (
              <div className="mt-4 flex flex-wrap items-start gap-2">
                <MusicSearch eventId={eventId} sectionId={section.id} onAdd={addSong} />
                <SpotifyImport eventId={eventId} sectionId={section.id} />
              </div>
            )}
            {atLimit && (
              <p className="mt-3 text-xs text-zinc-400">Limited to {section.song_limit} song{section.song_limit === 1 ? "" : "s"}.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function GuestToggle({ eventId, sectionId, enabled }: { eventId: string; sectionId: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => setSectionGuestAccess(eventId, sectionId, !enabled))}
      disabled={pending}
      className={`relative h-5 w-9 rounded-full transition ${enabled ? "bg-brand" : "bg-zinc-300 dark:bg-white/20"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function SpotifySyncBanner({
  eventId,
  sectionId,
  playlistName,
  syncedAt,
  canEdit,
}: {
  eventId: string;
  sectionId: string;
  playlistName: string;
  syncedAt: string | null;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const when = syncedAt
    ? new Date(syncedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/[0.07] p-3">
      <FontAwesomeIcon icon={faSpotify} className="text-lg text-[#1DB954]" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-zinc-800 dark:text-zinc-100">
          Live-synced with “{playlistName}”
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Auto-updates from Spotify about every hour{when ? ` · last synced ${when}` : ""}
        </p>
      </div>
      {canEdit && (
        <button
          onClick={() => { if (confirm("Stop live-syncing this playlist? The current songs stay, but they won't auto-update anymore.")) start(() => { disablePlaylistSync(eventId, sectionId); }); }}
          disabled={pending}
          className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:border-red-300 hover:text-red-500 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300"
        >
          {pending ? "Stopping…" : "Stop sync"}
        </button>
      )}
    </div>
  );
}

function SongRow({
  eventId,
  song,
  index,
  total,
  orderedIds,
  sectionId,
  canEdit,
  canMustPlay,
  mustPlayFull,
  showWhoAdded,
}: {
  eventId: string;
  song: PlanningSong;
  index: number;
  total: number;
  orderedIds: string[];
  sectionId: string;
  canEdit: boolean;
  canMustPlay: boolean;
  mustPlayFull: boolean;
  showWhoAdded: boolean;
}) {
  const [pending, start] = useTransition();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(song.note ?? "");
  const [err, setErr] = useState<string | null>(null);

  function move(dir: -1 | 1) {
    const next = [...orderedIds];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    start(() => reorderSongs(eventId, sectionId, next));
  }

  function mustPlay() {
    setErr(null);
    start(async () => {
      const res = await toggleMustPlay(eventId, song.id, !song.must_play);
      if (res && !res.ok) setErr(res.error ?? "Could not update");
    });
  }

  return (
    <li className={`rounded-xl border p-3 transition hover:shadow-sm dark:bg-white/[0.02] ${song.must_play ? "border-brand/40 bg-brand/[0.03]" : "border-zinc-200 bg-white dark:border-white/[0.06]"}`}>
      <div className="flex items-center gap-3">
        {canEdit && (
          <div className="flex flex-col text-zinc-300">
            <button onClick={() => move(-1)} disabled={index === 0 || pending} className="hover:text-brand disabled:opacity-30">▲</button>
            <button onClick={() => move(1)} disabled={index === total - 1 || pending} className="hover:text-brand disabled:opacity-30">▼</button>
          </div>
        )}
        <div className="group/art relative h-12 w-12 shrink-0">
          {song.artwork_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={song.artwork_url} alt="" className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-white/5">🎵</div>
          )}
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30 opacity-0 transition group-hover/art:opacity-100">
            <PreviewButton id={`song-${song.id}`} title={song.title} artist={song.artist} previewUrl={song.preview_url} size="sm" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">
            {song.must_play && <span className="mr-1 text-amber-500" title="Must play"><FontAwesomeIcon icon={faStarSolid} /></span>}
            {song.title}
          </p>
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
            {song.artist}
            {showWhoAdded && song.requested_by_name && <span className="text-zinc-400"> · added by {song.requested_by_name}</span>}
          </p>
        </div>

        <ProviderTag provider={song.provider} />

        {canMustPlay && (
          <button
            onClick={mustPlay}
            disabled={pending || (mustPlayFull && !song.must_play)}
            className={`text-sm transition ${song.must_play ? "text-amber-500" : "text-zinc-300 hover:text-amber-500"} disabled:opacity-30`}
            title={song.must_play ? "Must-play" : mustPlayFull ? "Must-play limit reached" : "Mark must-play"}
          >
            <FontAwesomeIcon icon={song.must_play ? faStarSolid : faStarOutline} />
          </button>
        )}

        <button
          onClick={() => start(() => toggleLike(eventId, song.id, !song.liked_by_me))}
          disabled={pending}
          className="flex items-center gap-1 text-sm text-zinc-400 hover:text-rose-500"
          title="Like"
        >
          <FontAwesomeIcon icon={song.liked_by_me ? faHeartSolid : faHeartOutline} className={song.liked_by_me ? "text-rose-500" : ""} />
          {song.like_count > 0 && <span>{song.like_count}</span>}
        </button>

        {canEdit && (
          <>
            <button onClick={() => setNoteOpen((o) => !o)} className="text-zinc-400 hover:text-brand" title="Note">
              <FontAwesomeIcon icon={faNoteSticky} className={song.note ? "text-brand dark:text-brand-lighter" : ""} />
            </button>
            <button onClick={() => start(() => removeSong(eventId, song.id))} disabled={pending} className="text-zinc-400 hover:text-red-500" title="Remove">
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </>
        )}
      </div>

      {err && <p className="mt-1 pl-15 text-xs text-red-500">{err}</p>}

      {(noteOpen || song.note) && (
        <div className="mt-2 pl-15">
          {canEdit ? (
            <input
              className="input w-full text-sm"
              placeholder="Add a note (dedication, must-play, instructions…)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note !== (song.note ?? "")) start(() => updateSongNote(eventId, song.id, note));
              }}
            />
          ) : (
            song.note && <p className="text-sm italic text-zinc-500">“{song.note}”</p>
          )}
        </div>
      )}
    </li>
  );
}

function ProviderTag({ provider }: { provider: PlanningSong["provider"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    spotify: { label: "Spotify", cls: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400" },
    apple: { label: "Apple", cls: "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-400" },
    youtube: { label: "YouTube", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400" },
    manual: { label: "Manual", cls: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300" },
  };
  const m = map[provider] ?? map.manual;
  return <span className={`hidden rounded px-1.5 py-0.5 text-[10px] font-semibold sm:inline ${m.cls}`}>{m.label}</span>;
}

function QuestionField({
  eventId,
  question,
  value,
  onChange,
}: {
  eventId: string;
  question: PlanningQuestion;
  value: string;
  onChange: (v: string) => void; // live update (drives conditional visibility)
}) {
  const [pending, start] = useTransition();
  const answered = value.trim() !== "";

  // Persist to the server (only when it differs from the saved value).
  function persist(v: string) {
    if (v !== (question.answer ?? "")) start(() => saveAnswer(eventId, question.id, v));
  }
  // Choices update the map AND save at once; text saves on blur.
  function pick(v: string) {
    onChange(v);
    persist(v);
  }

  return (
    <div>
      <label className="mb-1.5 flex items-start gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        <FontAwesomeIcon icon={faCheckCircle} className={`mt-0.5 ${answered ? "text-green-500" : "text-zinc-300 dark:text-zinc-600"}`} />
        <span>
          {question.prompt}
          {question.required && <span className="text-rose-500"> *</span>}
          {question.help_text && <span className="mt-0.5 block text-xs font-normal text-zinc-400">{question.help_text}</span>}
        </span>
      </label>
      <div className="pl-6">
        {question.answer_type === "long" ? (
          <textarea className="input min-h-[80px] w-full" value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => persist(value)} />
        ) : question.answer_type === "select" ? (
          <select className="input w-full" value={value} onChange={(e) => pick(e.target.value)}>
            <option value="">Select…</option>
            {question.options.map((o) => {
              const l = optLabel(o);
              return <option key={l} value={l}>{l}</option>;
            })}
          </select>
        ) : question.answer_type === "image_select" ? (
          <ImageSelect options={question.options} value={value} onChange={pick} />
        ) : question.answer_type === "yesno" ? (
          <div className="flex gap-2">
            {["Yes", "No"].map((o) => (
              <button key={o} onClick={() => pick(o)} className={pillCls(value === o)}>{o}</button>
            ))}
          </div>
        ) : question.answer_type === "scale" ? (
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((n) => (
              <button key={n} onClick={() => pick(n)} className={`h-9 w-9 ${pillCls(value === n)}`}>{n}</button>
            ))}
          </div>
        ) : question.answer_type === "multiselect" ? (
          <MultiSelect options={question.options} value={value} onChange={pick} />
        ) : (
          <input className="input w-full" value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => persist(value)} />
        )}
        {pending && <span className="mt-1 block text-xs text-zinc-400">Saving…</span>}
      </div>
    </div>
  );
}

function pillCls(active: boolean) {
  return `rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${
    active ? "border-brand bg-brand text-white" : "border-zinc-300 text-zinc-600 hover:border-brand dark:border-white/10 dark:text-zinc-300"
  }`;
}

function MultiSelect({ options, value, onChange }: { options: QuestionOption[]; value: string; onChange: (v: string) => void }) {
  const selected = new Set(value ? value.split("|").filter(Boolean) : []);
  function toggle(o: string) {
    const next = new Set(selected);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onChange(Array.from(next).join("|"));
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const l = optLabel(o);
        return <button key={l} onClick={() => toggle(l)} className={pillCls(selected.has(l))}>{l}</button>;
      })}
    </div>
  );
}

/** Image-option picker (e.g. Photo Booth Backdrop). Stores the chosen label. */
function ImageSelect({ options, value, onChange }: { options: QuestionOption[]; value: string; onChange: (v: string) => void }) {
  if (options.length === 0) {
    return <p className="text-sm text-zinc-400">No options have been set up yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((o) => {
        const l = optLabel(o);
        const img = optImage(o);
        const active = value === l;
        return (
          <button
            key={l}
            onClick={() => onChange(l)}
            className={`w-28 overflow-hidden rounded-xl border-2 text-left transition ${
              active ? "border-brand ring-2 ring-brand/30" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"
            }`}
          >
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt={l} className="h-28 w-full object-cover" />
            ) : (
              <div className="flex h-28 w-full items-center justify-center bg-zinc-100 text-zinc-400 dark:bg-white/5">🖼️</div>
            )}
            <p className={`truncate px-2 py-1.5 text-xs font-medium ${active ? "text-brand dark:text-brand-lighter" : "text-zinc-600 dark:text-zinc-300"}`}>{l}</p>
          </button>
        );
      })}
    </div>
  );
}

function ModeBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: typeof faRoute; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
        active ? "bg-white text-brand shadow-sm dark:bg-white/10 dark:text-brand-lighter" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
    >
      <FontAwesomeIcon icon={icon} /> {label}
    </button>
  );
}

function scrollPlannerTop() {
  if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
}

/** The guided one-section-at-a-time journey. Reuses SectionDetail; adds a
    progress header, Back/Continue, and a confetti finish. */
function GuidedFlow({
  eventId,
  steps,
  role,
  vendors,
  onSeeAll,
}: {
  eventId: string;
  steps: (PlanningSection & { group: string | null })[];
  role: PlannerRole;
  vendors: EventVendor[];
  onSeeAll: () => void;
}) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);

  if (steps.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-white/[0.08] dark:bg-white/[0.02]">
        Nothing to fill out just yet — check back soon!
      </div>
    );
  }

  const step = steps[Math.min(i, steps.length - 1)];
  const total = steps.length;

  function fire() {
    confetti({ particleCount: 150, spread: 75, origin: { y: 0.6 }, colors: ["#4b328e", "#8b6fd6", "#b9a5ef"] });
  }
  function next() {
    if (i < total - 1) { setI(i + 1); scrollPlannerTop(); } else { setDone(true); fire(); }
  }
  function back() { if (i > 0) { setI(i - 1); scrollPlannerTop(); } }

  if (done) {
    return (
      <div className="rounded-3xl border border-zinc-200 bg-white p-10 text-center shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02]">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-3xl text-brand dark:text-brand-lighter">
          <FontAwesomeIcon icon={faWandMagicSparkles} />
        </div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">You&apos;re all set!</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          Thanks for sharing the details — your DJ now has everything to make your night perfect. You can keep editing anytime.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={onSeeAll} className="btn-primary">Review all sections</button>
          <button onClick={() => { setDone(false); setI(0); scrollPlannerTop(); }} className="btn-ghost">Go through again</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-brand dark:text-brand-lighter">{step.group ?? "Planning"}</span>
          <span className="text-zinc-400">Step {i + 1} of {total}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-light transition-all duration-500" style={{ width: `${Math.round(((i + 1) / total) * 100)}%` }} />
        </div>
      </div>

      <div key={step.id} className="planner-step">
        <SectionDetail eventId={eventId} section={step} role={role} vendors={vendors} />
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button onClick={back} disabled={i === 0} className="btn-ghost disabled:opacity-40">
          <FontAwesomeIcon icon={faArrowLeft} className="mr-2" /> Back
        </button>
        <button onClick={next} className="btn-primary px-6 py-3 text-base">
          {i === total - 1 ? "Finish" : "Continue"} <FontAwesomeIcon icon={faArrowRight} className="ml-2" />
        </button>
      </div>
    </div>
  );
}
