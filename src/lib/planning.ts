/* Planning data access for the client experience portal (the in-house Vibo).
   Server-only. Reads use the caller's RLS-scoped client; seeding uses the
   service-role admin client because clients can't INSERT sections under RLS. */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type SectionType = "info" | "timeline" | "headline";
export type AnswerType = "short" | "long" | "select" | "multiselect" | "scale" | "yesno" | "image_select";
export type SongProvider = "spotify" | "apple" | "youtube" | "manual";

/** A question choice. Plain string for text dropdowns; object (with an uploaded
    image) for image_select questions like the Photo Booth Backdrop picker. */
export type QuestionOption = string | { label: string; image?: string | null };

export function optionLabel(o: QuestionOption): string {
  return typeof o === "string" ? o : o.label;
}
export function optionImage(o: QuestionOption): string | null {
  return typeof o === "string" ? null : o.image ?? null;
}

/** Per-section permissions: action -> roles allowed (always includes "dj").
    Missing key = app default (dj + host). Keys: delete, rename, cover,
    reorder_songs, edit_notes, change_time. */
export type SectionPermissions = Record<string, string[]>;

export interface PlanningSong {
  id: string;
  section_id: string;
  provider: SongProvider;
  provider_id: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  artwork_url: string | null;
  duration_ms: number | null;
  preview_url: string | null;
  external_url: string | null;
  note: string | null;
  must_play: boolean;
  requested_by: string | null;
  requested_by_name: string | null;
  sort_order: number;
  like_count: number;
  liked_by_me: boolean;
}

export interface PlanningQuestion {
  id: string;
  section_id: string;
  prompt: string;
  help_text: string | null;
  answer_type: AnswerType;
  options: QuestionOption[];
  required: boolean;
  sort_order: number;
  answer: string | null;
  condition_question_id: string | null;
  condition_values: string[];
}

/** Should a conditional question be shown, given the current answer map? */
export function questionVisible(q: PlanningQuestion, answers: Record<string, string>): boolean {
  if (!q.condition_question_id) return true;
  const ctrl = answers[q.condition_question_id];
  if (ctrl == null) return true; // controller not in scope → don't hide
  if (q.condition_values.length === 0) return ctrl.trim() !== "";
  const parts = ctrl.split("|"); // multiselect answers are "a|b"
  return q.condition_values.some((v) => parts.includes(v) || ctrl === v);
}

export interface PlanningSection {
  id: string;
  title: string;
  icon: string | null;
  section_type: SectionType;
  intro: string | null;
  time_label: string | null;
  client_editable: boolean;
  guest_enabled: boolean;
  song_limit: number | null;
  must_play_limit: number | null;
  songs_enabled: boolean;
  questions_enabled: boolean;
  notes_enabled: boolean;
  time_enabled: boolean;
  on_timeline: boolean | null; // null = auto (on when section_type==='timeline')
  on_music: boolean | null; // null = auto (vibe playlists: songs on + no single-song limit)
  section_cover_url: string | null;
  permissions: SectionPermissions;
  module: string | null;
  spotify_sync_playlist_name: string | null;
  spotify_synced_at: string | null;
  locked: boolean;
  sort_order: number;
  deleted_by_host: boolean;
  deleted_by_host_name: string | null;
  questions: PlanningQuestion[];
  songs: PlanningSong[];
  answered_count: number;
  must_play_count: number;
}

export type PlannerRole = "staff" | "host" | "guest";

export interface Person {
  id: string;
  name: string;
  email: string | null;
  role: string; // "Bride", "Planner", relationship label, etc.
  hasAccount: boolean;
  kind: "host" | "guest";
}

export interface AuditEntry {
  id: string;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

export interface EventPlanning {
  sections: PlanningSection[];
  hostDeletedSections: PlanningSection[]; // staff-only: sections the host removed
  totalQuestions: number;
  answeredQuestions: number;
  totalSongSlots: number; // sections with a song_limit
  filledSongSlots: number;
  auditLog: AuditEntry[]; // staff-only
}

/** Default roles for a section permission action (always grants dj). */
export function permAllows(
  permissions: SectionPermissions,
  action: string,
  role: PlannerRole,
): boolean {
  if (role === "staff") return true; // dj can always
  const roles = permissions?.[action] ?? ["dj", "host"];
  return role === "host" ? roles.includes("host") : false;
}

type Admin = ReturnType<typeof createAdminClient>;

/** Resolve which template an event should use: explicit assignment first
    (events.planning_template_id — set by a booking helper or staff), then a
    template matching the event type, then the global default. */
async function pickTemplateId(admin: Admin, eventId: string, eventTypeId: string | null): Promise<string | null> {
  const { data: ev } = await admin.from("events").select("planning_template_id").eq("id", eventId).maybeSingle();
  if (ev?.planning_template_id) return ev.planning_template_id as string;
  if (eventTypeId) {
    const { data } = await admin
      .from("planning_templates")
      .select("id")
      .eq("event_type_id", eventTypeId)
      .eq("is_library", false)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  const { data: def } = await admin
    .from("planning_templates")
    .select("id")
    .eq("is_default", true)
    .eq("is_library", false)
    .limit(1)
    .maybeSingle();
  return (def?.id as string | undefined) ?? null;
}

/** Clone a template's sections + questions into an event. */
async function seedFromTemplate(admin: Admin, eventId: string, templateId: string): Promise<boolean> {
  const { data: tSections } = await admin
    .from("planning_template_sections")
    .select("*")
    .eq("template_id", templateId)
    .order("sort_order");
  if (!tSections?.length) return false;

  // template question id -> new event question id (to remap conditions after).
  const pairs: { tqId: string; conditionOn: string | null; eid: string }[] = [];

  for (const ts of tSections) {
    const { data: section } = await admin
      .from("planning_sections")
      .insert({
        event_id: eventId,
        template_section_id: ts.id,
        title: ts.title,
        icon: ts.icon,
        section_type: ts.section_type,
        intro: ts.intro,
        time_label: ts.time_label,
        client_editable: ts.client_editable,
        guest_enabled: ts.guest_enabled,
        song_limit: ts.song_limit,
        must_play_limit: ts.must_play_limit,
        songs_enabled: ts.songs_enabled,
        questions_enabled: ts.questions_enabled,
        notes_enabled: ts.notes_enabled,
        time_enabled: ts.time_enabled,
        on_timeline: null,
        on_music: null,
        ai_picks_enabled: ts.ai_picks_enabled,
        section_cover_url: ts.section_cover_url,
        permissions: ts.permissions,
        module: ts.module,
        sort_order: ts.sort_order,
      })
      .select("id")
      .single();
    if (!section) continue;

    const { data: tQuestions } = await admin
      .from("planning_template_questions")
      .select("*")
      .eq("template_section_id", ts.id)
      .order("sort_order");

    if (tQuestions?.length) {
      const { data: inserted } = await admin
        .from("planning_questions")
        .insert(
          tQuestions.map((q) => ({
            section_id: section.id,
            event_id: eventId,
            prompt: q.prompt,
            help_text: q.help_text,
            answer_type: q.answer_type,
            options: q.options,
            required: q.required,
            sort_order: q.sort_order,
            condition_values: q.condition_values ?? [],
            // condition_question_id remapped in a second pass below
          })),
        )
        .select("id"); // single INSERT preserves VALUES order
      (inserted ?? []).forEach((row, idx) =>
        pairs.push({ tqId: tQuestions[idx].id, conditionOn: tQuestions[idx].condition_question_id ?? null, eid: row.id }),
      );
    }
  }

  // Remap conditional dependencies from template question ids to event ids.
  const qMap = new Map(pairs.map((p) => [p.tqId, p.eid]));
  await Promise.all(
    pairs
      .filter((p) => p.conditionOn)
      .map((p) =>
        admin
          .from("planning_questions")
          .update({ condition_question_id: qMap.get(p.conditionOn as string) ?? null })
          .eq("id", p.eid),
      ),
  );
  return true;
}

/** Clone the resolved template into an event's planning if it has none yet.
    Idempotent via an atomic claim. Returns true if it seeded. */
export async function ensureEventPlanning(
  eventId: string,
  eventTypeId: string | null,
): Promise<boolean> {
  const admin = createAdminClient();

  // Atomic claim: only the first caller flips planning_seeded false→true and
  // seeds. Concurrent first-loads that lose the claim skip (the dup-section fix).
  const { data: claimed } = await admin
    .from("events")
    .update({ planning_seeded: true })
    .eq("id", eventId)
    .eq("planning_seeded", false)
    .select("id")
    .maybeSingle();
  if (!claimed) return false;

  const templateId = await pickTemplateId(admin, eventId, eventTypeId);
  if (!templateId || !(await seedFromTemplate(admin, eventId, templateId))) {
    await admin.from("events").update({ planning_seeded: false }).eq("id", eventId);
    return false;
  }
  return true;
}

/** Switch an event to a specific template: assign it, wipe current planning, and
    re-seed. Used by booking-helper assignment and staff template changes.
    DESTRUCTIVE — clears existing sections/answers/songs for the event. */
export async function reseedEventPlanning(eventId: string, templateId: string): Promise<boolean> {
  const admin = createAdminClient();
  await admin.from("planning_sections").delete().eq("event_id", eventId);
  await admin.from("events").update({ planning_template_id: templateId, planning_seeded: true }).eq("id", eventId);
  const ok = await seedFromTemplate(admin, eventId, templateId);
  if (!ok) await admin.from("events").update({ planning_seeded: false }).eq("id", eventId);
  return ok;
}

/** Clone ONE template section (+ its questions, with intra-section conditional
    remapping) into an event's planner. Returns the new section id. Used to add a
    reusable section on demand and to auto-add an add-on's mapped sections. */
async function seedTemplateSection(
  admin: Admin,
  eventId: string,
  ts: Record<string, unknown>,
  sortOrder?: number,
): Promise<string | null> {
  const { data: section } = await admin
    .from("planning_sections")
    .insert({
      event_id: eventId,
      template_section_id: ts.id,
      title: ts.title,
      icon: ts.icon,
      section_type: ts.section_type,
      intro: ts.intro,
      time_label: ts.time_label,
      client_editable: ts.client_editable,
      guest_enabled: ts.guest_enabled,
      song_limit: ts.song_limit,
      must_play_limit: ts.must_play_limit,
      songs_enabled: ts.songs_enabled,
      questions_enabled: ts.questions_enabled,
      notes_enabled: ts.notes_enabled,
      time_enabled: ts.time_enabled,
      on_timeline: null,
      on_music: null,
      ai_picks_enabled: ts.ai_picks_enabled,
      section_cover_url: ts.section_cover_url,
      permissions: ts.permissions,
      module: ts.module,
      sort_order: sortOrder ?? ts.sort_order,
    })
    .select("id")
    .single();
  if (!section) return null;

  const { data: tQuestions } = await admin
    .from("planning_template_questions")
    .select("*")
    .eq("template_section_id", ts.id as string)
    .order("sort_order");

  if (tQuestions?.length) {
    const { data: inserted } = await admin
      .from("planning_questions")
      .insert(
        tQuestions.map((q) => ({
          section_id: section.id,
          event_id: eventId,
          prompt: q.prompt,
          help_text: q.help_text,
          answer_type: q.answer_type,
          options: q.options,
          required: q.required,
          sort_order: q.sort_order,
          condition_values: q.condition_values ?? [],
        })),
      )
      .select("id"); // single INSERT preserves VALUES order
    const idMap = new Map<string, string>();
    (inserted ?? []).forEach((row, idx) => idMap.set(tQuestions[idx].id, row.id));
    await Promise.all(
      (inserted ?? [])
        .map((row, idx) => {
          const cond = tQuestions[idx].condition_question_id;
          return cond
            ? admin.from("planning_questions").update({ condition_question_id: idMap.get(cond) ?? null }).eq("id", row.id)
            : null;
        })
        .filter(Boolean),
    );
  }
  return section.id;
}

/** Auto-add an add-on's mapped section templates to an event's planner. Skips
    any the event already has (deduped by template_section_id), and appends to
    the end. No-op when the add-on has no mapped sections. Admin-scoped — runs
    whenever an add-on is attached to an event. */
export async function assignAddonSections(eventId: string, addonId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: maps } = await admin
    .from("addon_section_templates")
    .select("template_section_id")
    .eq("addon_id", addonId);
  if (!maps?.length) return;

  const { data: existing } = await admin
    .from("planning_sections")
    .select("template_section_id, sort_order")
    .eq("event_id", eventId);
  const have = new Set((existing ?? []).map((s) => s.template_section_id).filter(Boolean));
  let nextSort = Math.max(0, ...(existing ?? []).map((s) => (s.sort_order as number) ?? 0)) + 1;

  for (const m of maps) {
    if (have.has(m.template_section_id)) continue;
    const { data: ts } = await admin
      .from("planning_template_sections")
      .select("*")
      .eq("id", m.template_section_id)
      .maybeSingle();
    if (!ts) continue;
    await seedTemplateSection(admin, eventId, ts, nextSort++);
    have.add(m.template_section_id);
  }
}

/** Clone one Section Templates *library* section into an event at a position
    (afterSortOrder + 1), opening a gap for it. Reuses seedTemplateSection so the
    section's questions + conditional links come along. Returns the new id.
    Staff-facing (admin-scoped) — the caller gates access. */
export async function addLibrarySectionToEvent(
  eventId: string,
  templateSectionId: string,
  afterSortOrder: number,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data: ts } = await admin
    .from("planning_template_sections")
    .select("*")
    .eq("id", templateSectionId)
    .maybeSingle();
  if (!ts) return null;

  const pos = afterSortOrder + 1;
  // Open a gap: bump everything at/after the insert position.
  const { data: toBump } = await admin
    .from("planning_sections")
    .select("id, sort_order")
    .eq("event_id", eventId)
    .gte("sort_order", pos);
  await Promise.all(
    (toBump ?? []).map((s) =>
      admin.from("planning_sections").update({ sort_order: s.sort_order + 1 }).eq("id", s.id),
    ),
  );

  return seedTemplateSection(admin, eventId, ts, pos);
}

/** Load the full planning tree for an event, scoped by the caller's RLS client.
    `role` shapes visibility: hosts/guests never see host-deleted sections; only
    staff get the host-deleted list and the audit log. */
export async function loadEventPlanning(
  supabase: SupabaseClient,
  eventId: string,
  myUserId: string,
  role: PlannerRole,
): Promise<EventPlanning> {
  const isStaff = role === "staff";
  const [{ data: sections }, { data: questions }, { data: answers }, { data: songs }, { data: likes }, audit] =
    await Promise.all([
      supabase.from("planning_sections").select("*").eq("event_id", eventId).order("sort_order"),
      supabase.from("planning_questions").select("*").eq("event_id", eventId).order("sort_order"),
      supabase.from("planning_question_answers").select("question_id, answer").eq("event_id", eventId),
      supabase.from("planning_songs").select("*").eq("event_id", eventId).order("sort_order"),
      supabase
        .from("planning_song_likes")
        .select("song_id, account_id, planning_songs!inner(event_id)")
        .eq("planning_songs.event_id", eventId),
      isStaff
        ? supabase
            .from("planning_audit_log")
            .select("id, actor_name, actor_role, action, detail, created_at")
            .eq("event_id", eventId)
            .order("created_at", { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [] as AuditEntry[] }),
    ]);

  const answerByQ = new Map<string, string>();
  for (const a of answers ?? []) if (a.answer != null) answerByQ.set(a.question_id, a.answer);

  const likeCount = new Map<string, number>();
  const likedByMe = new Set<string>();
  for (const l of likes ?? []) {
    likeCount.set(l.song_id, (likeCount.get(l.song_id) ?? 0) + 1);
    if (l.account_id === myUserId) likedByMe.add(l.song_id);
  }

  // Resolve "added by" + "deleted by" names (staff care who did what).
  const userIds = new Set<string>();
  for (const s of songs ?? []) if (s.requested_by) userIds.add(s.requested_by);
  for (const sec of sections ?? []) if (sec.deleted_by_host) userIds.add(sec.deleted_by_host);
  const names = await resolveUserNames(supabase, [...userIds]);

  const questionsBySection = new Map<string, PlanningQuestion[]>();
  for (const q of questions ?? []) {
    const list = questionsBySection.get(q.section_id) ?? [];
    list.push({
      id: q.id,
      section_id: q.section_id,
      prompt: q.prompt,
      help_text: q.help_text,
      answer_type: q.answer_type,
      options: Array.isArray(q.options) ? q.options : [],
      required: q.required,
      sort_order: q.sort_order,
      answer: answerByQ.get(q.id) ?? null,
      condition_question_id: q.condition_question_id ?? null,
      condition_values: Array.isArray(q.condition_values) ? q.condition_values : [],
    });
    questionsBySection.set(q.section_id, list);
  }

  const songsBySection = new Map<string, PlanningSong[]>();
  for (const s of songs ?? []) {
    const list = songsBySection.get(s.section_id) ?? [];
    list.push({
      ...s,
      must_play: s.must_play ?? false,
      requested_by_name: s.requested_by ? names.get(s.requested_by) ?? null : null,
      like_count: likeCount.get(s.id) ?? 0,
      liked_by_me: likedByMe.has(s.id),
    } as PlanningSong);
    songsBySection.set(s.section_id, list);
  }

  let totalQuestions = 0;
  let answeredQuestions = 0;
  let totalSongSlots = 0;
  let filledSongSlots = 0;

  const live: PlanningSection[] = [];
  const hostDeleted: PlanningSection[] = [];

  for (const sec of sections ?? []) {
    const qs = questionsBySection.get(sec.id) ?? [];
    const ss = songsBySection.get(sec.id) ?? [];
    const answered = qs.filter((q) => q.answer && q.answer.trim() !== "").length;
    const isDeleted = Boolean(sec.deleted_by_host_at);

    const section: PlanningSection = {
      id: sec.id,
      title: sec.title,
      icon: sec.icon,
      section_type: sec.section_type,
      intro: sec.intro,
      time_label: sec.time_label,
      client_editable: sec.client_editable,
      guest_enabled: sec.guest_enabled ?? false,
      song_limit: sec.song_limit,
      must_play_limit: sec.must_play_limit ?? null,
      songs_enabled: sec.songs_enabled ?? true,
      questions_enabled: sec.questions_enabled ?? true,
      notes_enabled: sec.notes_enabled ?? true,
      time_enabled: sec.time_enabled ?? false,
      on_timeline: sec.on_timeline ?? null,
      on_music: sec.on_music ?? null,
      section_cover_url: sec.section_cover_url ?? null,
      permissions: (sec.permissions ?? {}) as SectionPermissions,
      module: sec.module ?? null,
      spotify_sync_playlist_name: sec.spotify_sync_playlist_name ?? null,
      spotify_synced_at: sec.spotify_synced_at ?? null,
      locked: sec.locked,
      sort_order: sec.sort_order,
      deleted_by_host: isDeleted,
      deleted_by_host_name: sec.deleted_by_host ? names.get(sec.deleted_by_host) ?? null : null,
      questions: qs,
      songs: ss,
      answered_count: answered,
      must_play_count: ss.filter((s) => s.must_play).length,
    };

    if (isDeleted) {
      if (isStaff) hostDeleted.push(section);
      continue; // hosts/guests never see host-deleted sections
    }

    live.push(section);
    if (sec.section_type !== "headline") {
      totalQuestions += qs.length;
      answeredQuestions += answered;
      if (sec.song_limit != null) {
        totalSongSlots += sec.song_limit;
        filledSongSlots += Math.min(ss.length, sec.song_limit);
      }
    }
  }

  return {
    sections: live,
    hostDeletedSections: hostDeleted,
    totalQuestions,
    answeredQuestions,
    totalSongSlots,
    filledSongSlots,
    auditLog: (audit.data ?? []) as AuditEntry[],
  };
}

export interface EventVendor {
  id: string;
  vendor_id: string;
  company_name: string;
  role: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  arrival_time: string | null;
}

/** Load the event's vendor roster (the Vendor Team module reads this). */
export async function loadEventVendors(supabase: SupabaseClient, eventId: string): Promise<EventVendor[]> {
  const { data } = await supabase
    .from("event_vendors")
    .select("id, vendor_id, role, contact_name, contact_phone, contact_email, arrival_time, vendor:vendors(company_name)")
    .eq("event_id", eventId)
    .order("created_at");
  return (data ?? []).map((r) => ({
    id: r.id,
    vendor_id: r.vendor_id,
    company_name: (r.vendor as { company_name?: string } | null)?.company_name ?? "",
    role: r.role,
    contact_name: r.contact_name,
    contact_phone: r.contact_phone,
    contact_email: r.contact_email,
    arrival_time: r.arrival_time,
  }));
}

/** Resolve auth user ids → display names via accounts + linked rows. */
export async function resolveUserNames(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;

  const { data: accts } = await supabase
    .from("accounts")
    .select("auth_user_id, account_type, employee_id, client_id, event_guest_id, email")
    .in("auth_user_id", userIds);

  const empIds = (accts ?? []).map((a) => a.employee_id).filter(Boolean);
  const cliIds = (accts ?? []).map((a) => a.client_id).filter(Boolean);
  const guestIds = (accts ?? []).map((a) => a.event_guest_id).filter(Boolean);

  const [emps, clis, guests] = await Promise.all([
    empIds.length ? supabase.from("employees").select("id, first_name, last_name").in("id", empIds) : Promise.resolve({ data: [] }),
    cliIds.length ? supabase.from("clients").select("id, first_name, last_name").in("id", cliIds) : Promise.resolve({ data: [] }),
    guestIds.length ? supabase.from("event_guests").select("id, first_name, last_name").in("id", guestIds) : Promise.resolve({ data: [] }),
  ]);
  const nameOf = (r: { first_name?: string; last_name?: string } | undefined) =>
    r ? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() : "";
  const empMap = new Map((emps.data ?? []).map((e) => [e.id, nameOf(e)]));
  const cliMap = new Map((clis.data ?? []).map((c) => [c.id, nameOf(c)]));
  const guestMap = new Map((guests.data ?? []).map((g) => [g.id, nameOf(g)]));

  for (const a of accts ?? []) {
    let name = "";
    if (a.account_type === "staff" && a.employee_id) name = empMap.get(a.employee_id) ?? "";
    else if (a.account_type === "client" && a.client_id) name = cliMap.get(a.client_id) ?? "";
    else if (a.account_type === "event_guest" && a.event_guest_id) name = guestMap.get(a.event_guest_id) ?? "";
    out.set(a.auth_user_id, name || a.email || "Someone");
  }
  // Any id without an account row (e.g. owner) → generic.
  for (const id of userIds) if (!out.has(id)) out.set(id, "Staff");
  return out;
}

/** Resolve the acting user's planner role for an event (null = no access). */
export async function resolveEventRole(
  supabase: SupabaseClient,
  userId: string,
  accountType: "staff" | "client" | "event_guest",
  eventId: string,
): Promise<PlannerRole | null> {
  if (accountType === "staff") return "staff";

  const { data: account } = await supabase
    .from("accounts")
    .select("client_id, event_guest_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!account) return null;

  if (accountType === "client" && account.client_id) {
    const [{ data: primary }, { data: linked }] = await Promise.all([
      supabase.from("events").select("id").eq("id", eventId).eq("client_id", account.client_id).maybeSingle(),
      supabase
        .from("event_clients")
        .select("id")
        .eq("event_id", eventId)
        .eq("client_id", account.client_id)
        .maybeSingle(),
    ]);
    return primary || linked ? "host" : null;
  }
  if (accountType === "event_guest" && account.event_guest_id) {
    const { data: guest } = await supabase
      .from("event_guests")
      .select("id")
      .eq("id", account.event_guest_id)
      .eq("event_id", eventId)
      .maybeSingle();
    return guest ? "guest" : null;
  }
  return null;
}

/** Hosts (clients on the event) + Guests (invited helpers), with login status. */
export async function loadEventPeople(
  supabase: SupabaseClient,
  eventId: string,
): Promise<{ hosts: Person[]; guests: Person[] }> {
  const [{ data: event }, { data: clientRows }, { data: guestRows }, { data: accounts }] =
    await Promise.all([
      supabase.from("events").select("client_id").eq("id", eventId).maybeSingle(),
      supabase
        .from("event_clients")
        .select("role, is_primary, client:clients(id, first_name, last_name, email)")
        .eq("event_id", eventId),
      supabase
        .from("event_guests")
        .select("id, first_name, last_name, email, relationship")
        .eq("event_id", eventId)
        .order("created_at"),
      supabase.from("accounts").select("client_id, event_guest_id"),
    ]);

  const clientAccountIds = new Set((accounts ?? []).map((a) => a.client_id).filter(Boolean));
  const guestAccountIds = new Set((accounts ?? []).map((a) => a.event_guest_id).filter(Boolean));

  const hosts: Person[] = [];
  const seen = new Set<string>();
  for (const row of clientRows ?? []) {
    const c = row.client as unknown as { id: string; first_name: string; last_name: string; email: string | null } | null;
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    hosts.push({
      id: c.id,
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Host",
      email: c.email,
      role: row.is_primary ? `${row.role || "Host"} · Primary` : row.role || "Host",
      hasAccount: clientAccountIds.has(c.id),
      kind: "host",
    });
  }
  // Make sure the primary client (events.client_id) is represented even if not in event_clients.
  if (event?.client_id && !seen.has(event.client_id)) {
    const { data: c } = await supabase
      .from("clients")
      .select("id, first_name, last_name, email")
      .eq("id", event.client_id)
      .maybeSingle();
    if (c) {
      hosts.unshift({
        id: c.id,
        name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Host",
        email: c.email,
        role: "Host · Primary",
        hasAccount: clientAccountIds.has(c.id),
        kind: "host",
      });
    }
  }

  const guests: Person[] = (guestRows ?? []).map((g) => ({
    id: g.id,
    name: `${g.first_name ?? ""} ${g.last_name ?? ""}`.trim() || g.email || "Guest",
    email: g.email,
    role: g.relationship || "Guest",
    hasAccount: guestAccountIds.has(g.id),
    kind: "guest",
  }));

  return { hosts, guests };
}
