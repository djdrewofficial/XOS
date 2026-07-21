-- Two config tables were missed by the RLS scoping in 00084 / 00097 and still
-- carried the blanket "authenticated full access" (USING true / WITH CHECK true)
-- policy from 00001 — meaning any logged-in account, INCLUDING a client or event
-- guest on the shared mobile-app auth, could read AND write them:
--
--   * merge_tags          — the email/document merge-tag catalog (Settings → Email).
--   * email_blackout_dates — dates the scheduler must not send on (Settings → Email).
--
-- Neither has any client-facing read path: the mail/document renderers resolve
-- tags through render_merge_tags() (SECURITY DEFINER — bypasses RLS), and every
-- direct table read lives in staff-only Settings screens. So both are locked to
-- staff, matching the "staff only" pattern from 00097.
--
-- Dropped-then-created, so this migration is safe to re-run.

do $$
declare t text;
begin
  foreach t in array array['merge_tags','email_blackout_dates'] loop
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "staff only" on public.%I', t);
    execute format(
      'create policy "staff only" on public.%I for all to authenticated using (xos_is_staff()) with check (xos_is_staff())', t);
  end loop;
end $$;
