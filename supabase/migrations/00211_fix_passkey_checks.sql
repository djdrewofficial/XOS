-- Repair staff passkey checks that Postgres cannot compile.
--
-- 00210 is already applied. Its credential_id and public_key checks used a
-- bounded repeat whose upper count is above RE_DUP_MAX (255). Postgres stored
-- the constraints, then rejected every insert with
-- "invalid regular expression: invalid repetition count(s)".
--
-- The same rule, written so the regex engine never sees a count above 255:
-- length is char_length, and the alphabet check is an unbounded class.
-- Challenge and email-code patterns in 00209 and 00210 stay as they are.
-- Their counts are 128 and 64, which compile.
--
-- Apply in the Supabase SQL editor. This file is not applied by the app.

alter table public.staff_passkeys drop constraint if exists staff_passkeys_credential_id;
alter table public.staff_passkeys
  add constraint staff_passkeys_credential_id
  check (
    char_length(credential_id) between 16 and 512
    and credential_id ~ '^[A-Za-z0-9_-]+$'
  );

alter table public.staff_passkeys drop constraint if exists staff_passkeys_public_key;
alter table public.staff_passkeys
  add constraint staff_passkeys_public_key
  check (
    char_length(public_key) between 16 and 4096
    and public_key ~ '^[A-Za-z0-9_-]+$'
  );
