-- XOS — add "Partner B — Name" to the signing-requirements catalog. Append it to
-- the existing global default so it's required like the rest (00049 seeded the
-- list before this key existed). Per-type overrides are left as the office set them.
update journey_settings
  set required_signing_fields = required_signing_fields || array['partner_b_name']
  where not ('partner_b_name' = any(required_signing_fields));
