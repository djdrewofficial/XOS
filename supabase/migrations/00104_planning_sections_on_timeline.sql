-- Applied via Supabase MCP. Per-event override for whether a section shows on
-- the couple's client Timeline view. NULL = auto (on when section_type='timeline').
alter table planning_sections add column if not exists on_timeline boolean;
comment on column planning_sections.on_timeline is 'Per-event override for whether this section shows on the couple''s client Timeline view in the mobile app. NULL = auto (on when section_type = timeline). Does NOT affect planning templates or future events.';
