-- Per-event overtime hourly rate override.
-- When events.overtime_hourly is null, <overtime_rate> (and the Financials UI /
-- MCP effective rate) fall back to the package version snapshot, then the live
-- package's overtime_hourly. No backfill: existing events keep null and keep
-- using the package default. Package catalog values are unchanged.

alter table public.events
  add column if not exists overtime_hourly numeric(10,2) null;

comment on column public.events.overtime_hourly is
  'Per-event overtime $/hr override. Null = use package (version snapshot, then live packages.overtime_hourly).';

-- Prefer the event override when set; otherwise keep the existing package fallback.
-- Patches the LIVE render_merge_tags in place (pg_get_functiondef + replace)
-- instead of re-declaring it: prod's definition has drifted ahead of the last
-- full recreate in the repo, and a full re-create would silently drop later tags.
do $mig$
declare
  d text;
  old_expr text := $o$v_overtime := coalesce((select (pv.snapshot->>'overtime_hourly')::numeric from package_versions pv
      where pv.package_id = e.package_id and pv.version_no = e.package_version_no), p.overtime_hourly, 0);$o$;
  new_expr text := $n$v_overtime := coalesce(e.overtime_hourly, (select (pv.snapshot->>'overtime_hourly')::numeric from package_versions pv
      where pv.package_id = e.package_id and pv.version_no = e.package_version_no), p.overtime_hourly, 0);$n$;
begin
  d := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  if position('coalesce(e.overtime_hourly,' in d) > 0 then
    return; -- already applied
  end if;
  if position(old_expr in d) = 0 then
    raise exception 'render_merge_tags: overtime coalesce expression not found — not patched';
  end if;
  execute replace(d, old_expr, new_expr);
end
$mig$;
