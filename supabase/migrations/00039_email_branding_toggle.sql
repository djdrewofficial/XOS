-- XOS — per-template branding toggle. ON = branded shell (logo header + card);
-- OFF = plain content as written, for follow-ups where deliverability beats design.
alter table email_templates add column if not exists branded_shell boolean not null default true;
