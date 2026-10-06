-- <package_description>: this event's own wording (events.package_description_override,
-- edited on the Financials tab) -> the package version the event was sold with ->
-- the live package.
-- Patches the LIVE render_merge_tags in place (pg_get_functiondef + replace) instead
-- of re-declaring it: prod's definition has drifted ahead of 00162 in the repo
-- (dj_calendar_link, xos_welcome_link, unknown-tag stripping), and a full re-create
-- from the repo copy would silently drop those.
do $mig$
declare
  d text;
  old_expr text := $o$replace(xos_html_escape(coalesce(p.description, '')), E'\n', '<br>')$o$;
  new_expr text := $n$replace(xos_html_escape(coalesce(nullif(e.package_description_override, ''), (select pv.snapshot->>'description' from package_versions pv where pv.package_id = e.package_id and pv.version_no = e.package_version_no), p.description, '')), E'\n', '<br>')$n$;
begin
  d := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  if position('package_description_override' in d) > 0 then
    return; -- already applied
  end if;
  if position(old_expr in d) = 0 then
    raise exception 'render_merge_tags: <package_description> expression not found — not patched';
  end if;
  execute replace(d, old_expr, new_expr);
end
$mig$;
