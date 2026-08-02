-- "Invite to XOS" onboarding: an editable email template + a company_settings
-- pointer to it, plus the merge tags for the per-recipient set/reset-password
-- link. The event client-card "Invite to XOS" button renders this template
-- (render_merge_tags) and injects each person's unique recovery link into
-- <set_password_button> / <set_password_link> at send. One recovery link covers
-- both cases — a brand-new login sets a password, an existing one resets it.

alter table company_settings
  add column if not exists invite_template_id uuid references email_templates(id) on delete set null;

do $$
declare tpl_id uuid;
begin
  select id into tpl_id from email_templates where name = 'Client Invite / Set Password' limit 1;
  if tpl_id is null then
    insert into email_templates (name, display_name, group_name, subject, body_html, is_active, branded_shell)
    values (
      'Client Invite / Set Password',
      'Client Invite / Set Password',
      'ONBOARDING',
      'Set your password for <company_name>',
      '<p style="font-size:15px;color:#1d1d22;margin:0 0 10px;">Hi <first_name>,</p>'
      || '<p style="font-size:14px;color:#4a4a52;line-height:1.6;margin:0 0 6px;">Your <company_name> event planning account is ready. Tap below to set your password and sign in to plan your event &mdash; music, timeline, and details all in one place.</p>'
      || '<set_password_button>'
      || '<p style="font-size:12px;color:#8a8a94;line-height:1.6;margin:8px 0 0;">This link expires in 24 hours. If you didn''t expect this, you can safely ignore this email.</p>',
      true, true
    )
    returning id into tpl_id;
  end if;
  update company_settings set invite_template_id = tpl_id where id = true and invite_template_id is null;
end $$;

insert into merge_tags (tag_key, label, group_name, description, is_builtin, source_type, is_active, sort_order)
select * from (values
  ('set_password_button', 'Set-Password Button', 'Account',
   'Onboarding button — becomes each recipient''s unique set/reset-password link.', true, 'builtin', true, 0),
  ('set_password_link', 'Set-Password Link', 'Account',
   'Onboarding URL — each recipient''s unique set/reset-password link (plain URL).', true, 'builtin', true, 0)
) as t(tag_key, label, group_name, description, is_builtin, source_type, is_active, sort_order)
where not exists (select 1 from merge_tags mt where mt.tag_key = t.tag_key);
