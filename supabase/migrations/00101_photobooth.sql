-- XOS — Photo Booth planner module.
--
-- The photo-booth section is a SPECIAL planner experience (gated on
-- planning_sections.module = 'photobooth'): a swipeable gallery of XOS-curated
-- BACKDROPS + a swipeable picker of photo-booth DESIGNS that come live from the
-- TemplatesBooth API. TemplatesBooth is read-only and cannot store a selection,
-- so the couple's pick is persisted here, scoped to the event.
--
--   photobooth_backdrops        — staff-curated images (public bucket)
--   event_photobooth_selection  — the couple's chosen backdrop + design (per event)
--
-- Designs are NOT stored: the planner fetches them through the XOS proxy routes
-- (/api/mobile/booth-templates + portal server actions) which inject the API key
-- server-side. Only the chosen design's lightweight descriptor is saved below.

-- ── Backdrops (staff-curated gallery) ────────────────────────────────────────
create table if not exists photobooth_backdrops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Backdrop',
  image_path  text not null,           -- storage object path (for delete/replace)
  image_url   text not null,           -- resolved public URL (rendered by clients)
  category    text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists pbb_active_idx on photobooth_backdrops(is_active, sort_order);

alter table photobooth_backdrops enable row level security;

-- Staff curate everything. Couples (any authenticated event participant) may READ
-- active backdrops so the swipe gallery can render — the images live in a public
-- bucket anyway, so exposing active rows discloses nothing new.
do $$ begin
  create policy "staff manage backdrops" on photobooth_backdrops
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read active backdrops" on photobooth_backdrops
    for select to authenticated using (is_active or xos_is_staff());
exception when duplicate_object then null; end $$;

-- ── The couple's selection (one row per event) ───────────────────────────────
create table if not exists event_photobooth_selection (
  event_id    uuid primary key references events(id) on delete cascade,
  backdrop_id uuid references photobooth_backdrops(id) on delete set null,
  design      jsonb,   -- {src, post_url, layout_size, image_type, no_of_images, type, type_name, video_url?, poster?}
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table event_photobooth_selection enable row level security;

-- Staff + anyone on the event read & write (couple picks; staff fulfill).
-- Mirrors how planning answers save straight through RLS. xos_can_access_event
-- already grants staff (via xos_is_host).
do $$ begin
  create policy "access photobooth selection" on event_photobooth_selection
    for all to authenticated
    using (xos_can_access_event(event_id)) with check (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;

-- ── Backdrops storage bucket ─────────────────────────────────────────────────
-- Public read (images render in the planner). Writes happen via the service-role
-- client in a staff-gated server action, so no storage write policies are needed.
-- (00098 intentionally omits a public-listing SELECT policy — public buckets
-- serve files by URL without one.)
insert into storage.buckets (id, name, public)
values ('photobooth-backdrops', 'photobooth-backdrops', true)
on conflict (id) do nothing;

-- ── Wire existing photo-booth sections to the module ─────────────────────────
-- Any section/template-section named like "Photo Booth" becomes the special
-- module (and drops its songs/questions list — the module replaces it).
update planning_template_sections
  set module = 'photobooth', songs_enabled = false, questions_enabled = false
  where module is null and title ~* 'photo[[:space:]-]?booth';
update planning_sections
  set module = 'photobooth', songs_enabled = false, questions_enabled = false
  where module is null and title ~* 'photo[[:space:]-]?booth';

-- ── Seed the reusable Photo Booth section + map it to photo-booth add-ons ─────
-- Lives in the Section Templates library (is_library, migration 00100): it never
-- seeds onto an event by itself — it lands when a photo-booth add-on is attached
-- (assignAddonSections in lib/planning.ts, deduped by template_section_id).
do $$
declare
  lib_id uuid;
  sec_id uuid;
begin
  select id into lib_id from planning_templates where is_library limit 1;
  if lib_id is null then return; end if;

  select id into sec_id from planning_template_sections
    where template_id = lib_id and module = 'photobooth' limit 1;

  if sec_id is null then
    insert into planning_template_sections
      (template_id, title, icon, section_type, module, songs_enabled, questions_enabled,
       notes_enabled, time_enabled, intro, sort_order)
    values
      (lib_id, 'Your Photo-booth Xperience', '📸', 'info', 'photobooth', false, false,
       false, false,
       'Design your photo booth! Swipe through our backdrops and photo-strip designs, then tap to pick your favorites — your choice goes straight to our team.',
       999)
    returning id into sec_id;
  end if;

  -- Auto-attach on purchase of any photo-booth add-on (deduped on clone).
  insert into addon_section_templates (addon_id, template_section_id)
  select a.id, sec_id from addons a
  where a.name ~* 'photo[[:space:]-]?booth'
  on conflict (addon_id, template_section_id) do nothing;
end $$;
