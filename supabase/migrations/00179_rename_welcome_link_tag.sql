-- Rename the merge tag key <welcome_link> → <xos_welcome_link>.
-- Migrate any template that already references the old key, then repoint the
-- renderer's resolution to the new key.
update email_templates set body_html = replace(body_html, '<welcome_link>', '<xos_welcome_link>')
  where body_html like '%<welcome_link>%';
update email_templates set subject = replace(subject, '<welcome_link>', '<xos_welcome_link>')
  where subject like '%<welcome_link>%';

update merge_tags set tag_key = 'xos_welcome_link' where tag_key = 'welcome_link';

do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
begin
  if position('<xos_welcome_link>' in src) > 0 then return; end if;       -- already renamed
  if position('<welcome_link>' in src) = 0 then raise exception 'render_merge_tags: <welcome_link> not found'; end if;
  execute replace(src, '<welcome_link>', '<xos_welcome_link>');
end $mig$;
