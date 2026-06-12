-- XOS — realtime inbox: stream hl_conversations / hl_messages changes to the
-- browser via Supabase Realtime (postgres_changes). Any sync run anywhere
-- (cron, tick, webhook, another tab) pushes straight into open inbox UIs.

do $$ begin
  alter publication supabase_realtime add table hl_conversations;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table hl_messages;
exception when duplicate_object then null; end $$;
