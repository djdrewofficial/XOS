-- XOS — client signing (phase 2): notification type for signed documents.
-- The signing flow itself uses existing columns (documents.access_token,
-- signer_* fields, doc_hash) and the document_views tracking table.

update company_settings
set notif_types = array_append(notif_types, 'document_signed')
where id = true and not ('document_signed' = any (notif_types));
