-- Remove the <client_first_name> merge tag (registry row + renderer resolution).
-- (<first_name> still resolves the client's first name.)
delete from public.merge_tags where tag_key = 'client_first_name';

do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  block text := $a$out_text := replace(out_text, '<first_name>', xos_html_escape(c.first_name));
  out_text := replace(out_text, '<client_first_name>', xos_html_escape(c.first_name));$a$;
  keep text := $a$out_text := replace(out_text, '<first_name>', xos_html_escape(c.first_name));$a$;
begin
  if position('<client_first_name>' in src) = 0 then return; end if;  -- already gone
  execute replace(src, block, keep);
end $mig$;
