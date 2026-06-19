-- Per-section "For You" song suggestions toggle. Off by default; the DJ turns it
-- on per section. Mirrored onto template sections so it propagates when a
-- template is seeded into an event (seedFromTemplate copies this column).

alter table planning_sections          add column if not exists ai_picks_enabled boolean not null default false;
alter table planning_template_sections add column if not exists ai_picks_enabled boolean not null default false;

-- Enable on the "Villa Toscana — Wedding" template's four key moments:
-- Pre-Ceremony, Cocktail Hour, Dinner Music, Open Dancing Music.
update planning_template_sections set ai_picks_enabled = true
 where id in (
   'f6c1216d-0eb7-4733-b096-cc26f73294eb',
   '9a3c3d6d-4776-4527-a54d-6a10add31719',
   '6f18ad21-c988-433e-85cf-94647644b482',
   '4e3801e5-5b49-4054-bc48-22aa0b3520cb'
 );

-- Backfill events already seeded from those template sections.
update planning_sections set ai_picks_enabled = true
 where template_section_id in (
   'f6c1216d-0eb7-4733-b096-cc26f73294eb',
   '9a3c3d6d-4776-4527-a54d-6a10add31719',
   '6f18ad21-c988-433e-85cf-94647644b482',
   '4e3801e5-5b49-4054-bc48-22aa0b3520cb'
 );
