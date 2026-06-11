-- XOS — add "No Tag or Collab" option to vendor social posting preference
alter table vendors drop constraint vendors_social_collab_check;
alter table vendors add constraint vendors_social_collab_check
  check (social_collab is null or social_collab in ('collab', 'tag', 'either', 'none'));
