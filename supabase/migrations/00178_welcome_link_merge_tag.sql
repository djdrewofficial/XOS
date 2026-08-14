-- Per-event "Welcome / Get Started" link merge tag. Unlike a static custom tag, this
-- resolves to each event's secure welcome page (/welcome/<pay_token>) at send time,
-- so it works in SMS and email via render_merge_tags. Registered as a built-in so it
-- shows in the template editor's merge-tag picker (Client Journey group).
insert into public.merge_tags (tag_key, label, group_name, description, source_type, source_value, is_builtin, is_active)
values (
  'welcome_link',
  'Welcome / Get-Started Link',
  'Client Journey',
  'The client''s per-event welcome page to start planning — https://xos.xpressdjs.com/welcome/<token>',
  'builtin',
  null,
  true,
  true
)
on conflict (tag_key) do update
  set label = excluded.label, group_name = excluded.group_name,
      description = excluded.description, source_type = 'builtin',
      is_builtin = true, is_active = true;

-- Resolve <welcome_link> in render_merge_tags (patched in place off the live
-- definition; aborts if the anchor moved, no-ops if already present).
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));$a$;
  addition text := $a$out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));
  out_text := replace(out_text, '<welcome_link>', case when e.pay_token is not null then 'https://xos.xpressdjs.com/welcome/' || e.pay_token::text else '' end);$a$;
begin
  if position('<welcome_link>' in src) > 0 then return; end if; -- already patched
  if strpos(src, anchor) = 0 then raise exception 'render_merge_tags: <current_date> anchor not found'; end if;
  execute replace(src, anchor, addition);
end $mig$;
