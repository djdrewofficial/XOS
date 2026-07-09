-- Client-addable section templates.
--
-- Some sections are common but not defaulted onto every couple's plan/timeline
-- (Bouquet Toss, Chair Game, Anniversary Dance, …). Staff mark those template
-- sections `client_addable`, and the couple can add them from the app — or build
-- a fully custom section (name + notes + up to 3 songs).
--
-- Distinct from `guest_enabled` (which controls whether invited event-guests can
-- SEE/answer a section). This flag controls whether the couple can ADD it.

alter table planning_template_sections
  add column if not exists client_addable boolean not null default false;
