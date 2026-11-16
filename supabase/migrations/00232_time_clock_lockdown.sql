-- 00232_time_clock_lockdown: field staff cannot edit timesheet/pay columns or
-- mutate punches. Self-punches are insert-only with server-side stamped time
-- and source='self'. Office UPDATE/DELETE on time_punches is audited into
-- time_punch_edits (reason required when settings say so).
-- Safe to re-run. Does not apply data changes. Depends on 00230.

-- ───────────────────── 1. event_staff guard: drop pay/timesheet fields ─────────────────────
-- Punch sync still bypasses via xos.syncing_punches (set in xos_sync_event_staff_from_punches).
create or replace function public.xos_event_staff_field_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array[
    'notified_at', 'confirmed_at', 'declined_at', 'checked_in_at', 'checked_out_at'
  ];
begin
  if current_setting('xos.syncing_punches', true) = '1' then
    return coalesce(new, old);
  end if;
  if auth.uid() is null or not public.xos_is_field_staff() then
    return coalesce(new, old);
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'field staff cannot % event staff assignments', lower(tg_op) using errcode = '42501';
  end if;
  if old.employee_id is distinct from public.xos_current_employee_id() then
    raise exception 'field staff can only update their own assignment' using errcode = '42501';
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'field staff can only update check-in/confirmation fields' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ───────────────────── 2. self-punch stamp + office edit reason gate ─────────────────────
create or replace function public.xos_set_punch_edit_reason(p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.xos_sees_all_events() then
    raise exception 'only office can set punch edit reason' using errcode = '42501';
  end if;
  perform set_config('xos.punch_edit_reason', coalesce(p_reason, ''), true);
end;
$$;
revoke all on function public.xos_set_punch_edit_reason(text) from public, anon;
grant execute on function public.xos_set_punch_edit_reason(text) to authenticated, service_role;

create or replace function public.xos_time_punches_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  es record;
  reason text;
  require_reason boolean;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and public.xos_is_field_staff() then
      select es0.employee_id, es0.event_id
        into es
      from public.event_staff es0
      where es0.id = new.event_staff_id;
      if es.employee_id is null
         or es.employee_id is distinct from public.xos_current_employee_id() then
        raise exception 'field staff can only punch their own assignments'
          using errcode = '42501';
      end if;
      new.employee_id := es.employee_id;
      new.event_id := es.event_id;
      new.source := 'self';
      -- Ignore client clock: always stamp server now for self punches.
      new.punched_at := now();
      new.created_by := coalesce(public.xos_current_employee_id(), new.created_by);
      new.deleted_at := null;
    end if;
    return new;
  end if;

  -- UPDATE / DELETE: field staff blocked (RLS also denies; belt and suspenders).
  if auth.uid() is not null and public.xos_is_field_staff() then
    raise exception 'field staff cannot % punches', lower(tg_op) using errcode = '42501';
  end if;

  -- Office/direct API edits: when settings require a reason, demand the
  -- transaction-local GUC (set via xos_set_punch_edit_reason in the same tx).
  -- auth.uid() null (service_role / definer paths) is not gated here.
  if auth.uid() is not null and public.xos_sees_all_events() then
    select coalesce(admin_edit_requires_reason, true)
      into require_reason
    from public.time_clock_settings
    where id
    limit 1;
    reason := nullif(btrim(coalesce(current_setting('xos.punch_edit_reason', true), '')), '');
    if coalesce(require_reason, true) and reason is null then
      raise exception 'a reason is required for punch edits' using errcode = '22023';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;
revoke all on function public.xos_time_punches_before_write() from public, anon, authenticated;

drop trigger if exists time_punches_before_write on public.time_punches;
create trigger time_punches_before_write
  before insert or update or delete on public.time_punches
  for each row execute function public.xos_time_punches_before_write();

-- ───────────────────── 3. audit every office UPDATE/DELETE on punches ─────────────────────
create or replace function public.xos_time_punches_audit_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  editor uuid := public.xos_current_employee_id();
  reason text := nullif(btrim(coalesce(current_setting('xos.punch_edit_reason', true), '')), '');
  act text;
  staff_id uuid;
begin
  -- Self-service inserts are not admin edits.
  if tg_op = 'INSERT' then
    return new;
  end if;

  if editor is null then
    -- Unlinked/service writes still mutate; skip audit row if we cannot attribute.
    return coalesce(new, old);
  end if;

  reason := coalesce(reason, case
    when tg_op = 'DELETE' then 'deleted'
    when tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then 'deleted'
    else 'updated'
  end);

  if tg_op = 'DELETE' then
    act := 'delete';
    staff_id := old.event_staff_id;
    insert into public.time_punch_edits (
      punch_id, event_staff_id, action, before_row, after_row, reason, edited_by
    ) values (
      old.id, staff_id, act, to_jsonb(old), null, reason, editor
    );
    return old;
  end if;

  -- UPDATE
  if old.deleted_at is null and new.deleted_at is not null then
    act := 'delete';
  else
    act := 'update';
  end if;
  staff_id := new.event_staff_id;
  insert into public.time_punch_edits (
    punch_id, event_staff_id, action, before_row, after_row, reason, edited_by
  ) values (
    new.id, staff_id, act, to_jsonb(old), to_jsonb(new), reason, editor
  );
  return new;
end;
$$;
revoke all on function public.xos_time_punches_audit_edit() from public, anon, authenticated;

drop trigger if exists time_punches_audit_edit on public.time_punches;
create trigger time_punches_audit_edit
  after update or delete on public.time_punches
  for each row execute function public.xos_time_punches_audit_edit();

-- ───────────────────── 4. RLS: field staff insert-only on own punches ─────────────────────
drop policy if exists "field staff scope" on public.time_punches;
drop policy if exists "field staff scope sel" on public.time_punches;
drop policy if exists "field staff scope ins" on public.time_punches;
drop policy if exists "field staff scope upd" on public.time_punches;
drop policy if exists "field staff scope del" on public.time_punches;

create policy "field staff scope sel" on public.time_punches
  as restrictive for select to authenticated
  using (
    xos_sees_all_events()
    or employee_id = xos_current_employee_id()
  );

create policy "field staff scope ins" on public.time_punches
  as restrictive for insert to authenticated
  with check (
    xos_sees_all_events()
    or (
      source = 'self'
      and employee_id = xos_current_employee_id()
      and deleted_at is null
      and exists (
        select 1 from public.event_staff es
        where es.id = event_staff_id
          and es.employee_id = xos_current_employee_id()
      )
    )
  );

create policy "field staff scope upd" on public.time_punches
  as restrictive for update to authenticated
  using (xos_sees_all_events())
  with check (xos_sees_all_events());

create policy "field staff scope del" on public.time_punches
  as restrictive for delete to authenticated
  using (xos_sees_all_events());

-- Audit table: field staff read own assignment history; only office writes.
drop policy if exists "field staff scope" on public.time_punch_edits;
drop policy if exists "field staff scope sel" on public.time_punch_edits;
drop policy if exists "field staff scope ins" on public.time_punch_edits;
drop policy if exists "field staff scope upd" on public.time_punch_edits;
drop policy if exists "field staff scope del" on public.time_punch_edits;

create policy "field staff scope sel" on public.time_punch_edits
  as restrictive for select to authenticated
  using (
    xos_sees_all_events()
    or exists (
      select 1 from public.event_staff es
      where es.id = event_staff_id
        and es.employee_id = xos_current_employee_id()
    )
  );

create policy "field staff scope ins" on public.time_punch_edits
  as restrictive for insert to authenticated
  with check (xos_sees_all_events());

create policy "field staff scope upd" on public.time_punch_edits
  as restrictive for update to authenticated
  using (xos_sees_all_events())
  with check (xos_sees_all_events());

create policy "field staff scope del" on public.time_punch_edits
  as restrictive for delete to authenticated
  using (xos_sees_all_events());

-- ───────────────────── 5. office RPCs (reason + mutate in one transaction) ─────────────────────
-- PostgREST cannot carry set_config across separate HTTP calls, so UPDATE/DELETE
-- go through these helpers when admin_edit_requires_reason is on.

create or replace function public.xos_time_punch_admin_update(
  p_id uuid,
  p_patch jsonb,
  p_reason text
)
returns public.time_punches
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.time_punches;
begin
  if auth.uid() is not null and not public.xos_sees_all_events() then
    raise exception 'only office can edit punches' using errcode = '42501';
  end if;
  perform public.xos_set_punch_edit_reason(p_reason);
  update public.time_punches tp
  set
    punch_type = coalesce(p_patch->>'punch_type', tp.punch_type),
    punched_at = coalesce((p_patch->>'punched_at')::timestamptz, tp.punched_at),
    lat = case when p_patch ? 'lat' then nullif(p_patch->>'lat', '')::numeric else tp.lat end,
    lng = case when p_patch ? 'lng' then nullif(p_patch->>'lng', '')::numeric else tp.lng end,
    accuracy_m = case when p_patch ? 'accuracy_m' then nullif(p_patch->>'accuracy_m', '')::numeric else tp.accuracy_m end,
    venue_lat = case when p_patch ? 'venue_lat' then nullif(p_patch->>'venue_lat', '')::numeric else tp.venue_lat end,
    venue_lng = case when p_patch ? 'venue_lng' then nullif(p_patch->>'venue_lng', '')::numeric else tp.venue_lng end,
    distance_m = case when p_patch ? 'distance_m' then nullif(p_patch->>'distance_m', '')::numeric else tp.distance_m end,
    location_missing = coalesce((p_patch->>'location_missing')::boolean, tp.location_missing),
    note = case when p_patch ? 'note' then nullif(p_patch->>'note', '') else tp.note end,
    source = coalesce(nullif(p_patch->>'source', ''), 'admin'),
    deleted_at = case
      when p_patch ? 'deleted_at' then nullif(p_patch->>'deleted_at', '')::timestamptz
      else tp.deleted_at
    end
  where tp.id = p_id
  returning * into r;
  if r.id is null then
    raise exception 'punch not found' using errcode = 'P0002';
  end if;
  return r;
end;
$$;

create or replace function public.xos_time_punch_admin_soft_delete(
  p_id uuid,
  p_reason text
)
returns public.time_punches
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.time_punches;
begin
  if auth.uid() is not null and not public.xos_sees_all_events() then
    raise exception 'only office can edit punches' using errcode = '42501';
  end if;
  perform public.xos_set_punch_edit_reason(p_reason);
  update public.time_punches
  set deleted_at = now()
  where id = p_id and deleted_at is null
  returning * into r;
  if r.id is null then
    raise exception 'punch not found' using errcode = 'P0002';
  end if;
  return r;
end;
$$;

revoke all on function public.xos_time_punch_admin_update(uuid, jsonb, text) from public, anon;
revoke all on function public.xos_time_punch_admin_soft_delete(uuid, text) from public, anon;
grant execute on function public.xos_time_punch_admin_update(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.xos_time_punch_admin_soft_delete(uuid, text) to authenticated, service_role;

comment on function public.xos_set_punch_edit_reason(text) is
  'Sets transaction-local reason for time_punches UPDATE/DELETE audit trigger.';
comment on function public.xos_time_punches_before_write() is
  'Field staff: force self punch stamp. Office: require edit reason when configured.';
comment on function public.xos_time_punches_audit_edit() is
  'Writes time_punch_edits for every office UPDATE/DELETE on time_punches.';
comment on function public.xos_time_punch_admin_update(uuid, jsonb, text) is
  'Office punch UPDATE with reason in one transaction (audited by trigger).';
comment on function public.xos_time_punch_admin_soft_delete(uuid, text) is
  'Office soft-delete punch with reason in one transaction (audited by trigger).';
