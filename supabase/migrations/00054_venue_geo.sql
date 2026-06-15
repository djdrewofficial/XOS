-- XOS — store geo + Google place id on venues so a client can pick their venue
-- from Google Maps on the /proposal page (and we keep coordinates for future
-- distance / auto-mileage use).
alter table venues add column if not exists lat numeric(9,6);
alter table venues add column if not exists lng numeric(9,6);
alter table venues add column if not exists google_place_id text;
