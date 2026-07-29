-- Let an email template pick file labels to attach on every send (in addition to
-- the <document_LABEL> body tag). Stored as an array of file_label_definitions ids.
alter table email_templates
  add column if not exists attach_file_label_ids uuid[] not null default '{}';
