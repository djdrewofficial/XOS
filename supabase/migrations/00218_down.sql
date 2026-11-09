-- Rollback for 00218_field_staff_lockdown.sql: drop every "field staff scope"
-- restrictive policy. Touches no data; field staff go back to 00217 behaviour
-- (assigned-only via xos_is_host / storage / render_merge_tags, but base tables
-- readable). NOT a numbered migration — run by hand in the SQL editor if needed.
do $$
declare r record;
begin
  for r in
    select p.polname, n.nspname, c.relname
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.polname in ('field staff scope', 'field staff scope ins', 'field staff scope upd', 'field staff scope del')
  loop
    execute format('drop policy if exists %I on %I.%I', r.polname, r.nspname, r.relname);
  end loop;
end $$;

notify pgrst, 'reload schema';
