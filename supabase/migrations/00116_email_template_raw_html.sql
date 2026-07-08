-- Marks an email template whose body is authored as raw HTML (e.g. exported from
-- BeeFree/Mailchimp) rather than the rich-text editor. The editor renders a code
-- box instead of tiptap for these so images, tables, buttons, and social icons
-- are preserved; the send pipeline already passes full HTML documents through
-- untouched (brandWrap detects a complete <!doctype/<html> document).
alter table email_templates
  add column if not exists is_raw_html boolean not null default false;
