-- Applied via Supabase MCP. Per-event override for whether a section feeds the
-- couple app Music tab (vibe curation). NULL = auto (songs on + no single-song limit).
alter table planning_sections add column if not exists on_music boolean;
comment on column planning_sections.on_music is 'Per-event override for whether this section shows on the couple app Music tab (vibe curation). NULL = auto (on when songs_enabled and no single-song limit). Set by staff in Section Settings; does not affect templates.';
