-- Configurable Client Journeys.
--
-- Until now the onboarding flow was a single linear pipeline (confirm → sign
-- contract → pay → plan), varied only by event type. A journey type lets staff
-- define alternate paths — notably a venue-partner path (welcome email → confirm
-- info → sign a light agreement → download the app + book an onboarding meeting,
-- with NO payment) for clients booked through an exclusive venue like Villa
-- Toscana. A booking helper assigns the journey to an event (see 00122).

create table if not exists journey_types (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  description           text,
  -- exactly one row is the built-in default; a null events.journey_type_id
  -- behaves like the default (the standard direct-booking flow).
  is_default            boolean not null default false,
  -- which steps the client goes through
  step_confirm_info     boolean not null default true,
  step_sign_agreement   boolean not null default true,
  step_payment          boolean not null default true,
  step_app_onboarding   boolean not null default false,
  step_book_meeting     boolean not null default false,
  step_planner          boolean not null default true,
  -- which agreement to sign (null = fall back to the normal per-type contract)
  agreement_template_id uuid references document_templates(id) on delete set null,
  -- staff-pasted embed (e.g. HighLevel/Calendly) shown on the final page when
  -- step_book_meeting is on
  calendar_embed        text,
  -- optional copy for the post-sign final page
  final_page_heading    text,
  final_page_body       text,
  is_active             boolean not null default true,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- at most one default journey
create unique index if not exists journey_types_one_default
  on journey_types(is_default) where is_default;

alter table events
  add column if not exists journey_type_id uuid references journey_types(id) on delete set null;

-- Photo/video release opt-out, captured at signing (the venue agreement lets the
-- client decline). photo_release marks a template/doc as carrying the opt-out;
-- photo_release_declined records the client's choice on the signed document.
alter table document_templates add column if not exists photo_release boolean not null default false;
alter table documents         add column if not exists photo_release boolean not null default false;
alter table documents         add column if not exists photo_release_declined boolean;

alter table journey_types enable row level security;
do $$ begin
  create policy "staff manage journey types" on journey_types
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- Seed the built-in Direct journey (only if none exists).
insert into journey_types
  (name, description, is_default,
   step_confirm_info, step_sign_agreement, step_payment,
   step_app_onboarding, step_book_meeting, step_planner, sort_order)
select
  'Direct (standard)',
  'Full booking: the client confirms details, signs the contract, pays, then plans.',
  true, true, true, true, false, false, true, 0
where not exists (select 1 from journey_types where is_default);

-- Seed a Venue Partner journey (welcome → confirm → light agreement → app +
-- onboarding meeting, no payment). Its agreement template + calendar embed are
-- wired up in 00123.
insert into journey_types
  (name, description, is_default,
   step_confirm_info, step_sign_agreement, step_payment,
   step_app_onboarding, step_book_meeting, step_planner,
   final_page_heading, final_page_body, sort_order)
select
  'Venue Partner',
  'For clients booked through an exclusive venue partner (e.g. Villa Toscana). No payment through us — they confirm info, sign a light agreement, then download the app and book their onboarding meeting.',
  false, true, true, false, true, true, true,
  'You''re all set!',
  'First, book your Exclusive Venue Onboarding call below. Then download the Xpress app and sign in with the login details we emailed you — that''s where you''ll plan your event.',
  10
where not exists (select 1 from journey_types where name = 'Venue Partner');
