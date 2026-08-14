-- <client_first_name>: the primary client's first name only (a clearer alias of the
-- existing <first_name>, matching <client_email> / <client_cell> naming). Registered
-- as a Client-group built-in so it shows in the template picker.
insert into public.merge_tags (tag_key, label, group_name, description, source_type, source_value, is_builtin, is_active)
values ('client_first_name', 'Client First Name', 'Client', 'The primary client''s first name only', 'builtin', null, true, true)
on conflict (tag_key) do update
  set label = excluded.label, group_name = excluded.group_name, description = excluded.description,
      source_type = 'builtin', is_builtin = true, is_active = true;

do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$out_text := replace(out_text, '<first_name>', xos_html_escape(c.first_name));$a$;
  addition text := $a$out_text := replace(out_text, '<first_name>', xos_html_escape(c.first_name));
  out_text := replace(out_text, '<client_first_name>', xos_html_escape(c.first_name));$a$;
begin
  if position('<client_first_name>' in src) > 0 then return; end if;      -- already present
  if strpos(src, anchor) = 0 then raise exception 'render_merge_tags: <first_name> anchor not found'; end if;
  execute replace(src, anchor, addition);
end $mig$;
