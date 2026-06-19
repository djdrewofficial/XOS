-- XOS — give venues their own contact fields instead of stuffing the contact
-- person, phone, email, and website into the free-text notes box (which is how
-- the DJEP import landed them). Adds the columns, then backfills from the
-- structured "Phone: / Email: / Website: / Manager:" lines the import wrote and
-- strips those lines back out of notes, leaving only genuine notes behind.

alter table venues
  add column if not exists contact_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text;

-- backfill the dedicated fields from the import's labeled lines (only fills a
-- blank field; never clobbers a value already set)
update venues set
  phone        = coalesce(phone,        nullif(btrim(substring(notes from 'Phone:[ \t]*([^\r\n]+)')), '')),
  email        = coalesce(email,        nullif(btrim(substring(notes from 'Email:[ \t]*([^\r\n]+)')), '')),
  website      = coalesce(website,      nullif(btrim(substring(notes from 'Website:[ \t]*([^\r\n]+)')), '')),
  contact_name = coalesce(contact_name, nullif(btrim(substring(notes from 'Manager:[ \t]*([^\r\n]+)')), ''))
where notes ~ '(Phone|Email|Website|Manager):';

-- remove the now-migrated label lines from notes; null out notes that held
-- nothing else
update venues set
  notes = nullif(btrim(regexp_replace(notes, '(Phone|Email|Website|Manager):[^\r\n]*\r?\n?', '', 'g')), '')
where notes ~ '(Phone|Email|Website|Manager):';
