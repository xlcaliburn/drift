-- M7: durable transcript / dice log / narrator history.
--
-- Until now the play session (chat transcript, dice/event log, and the narrator's
-- model history) lived ONLY in the server's in-memory cache. Any process reset —
-- a server restart, a serverless cold start, or a Next dev hot-reload — dropped it,
-- so a refresh rebuilt just the opening recap and the player "lost" their run.
--
-- This table is a per-campaign runtime SNAPSHOT: the authoritative source for
-- restoring a live session. It is upserted after every turn and read on cold load.
-- (The normalized scenes/turns/rolls tables remain for a future browsable journal;
-- they can't hold the raw Anthropic tool_use/tool_result history a resume needs.)

create table if not exists campaign_runtime (
  campaign_id text primary key references campaigns(id) on delete cascade,
  transcript  jsonb not null default '[]',   -- display ChatEntry[]
  history     jsonb not null default '[]',    -- Anthropic MessageParam[] (narrator memory)
  log         jsonb not null default '[]',    -- EngineEvent[] (dice / event log)
  focus_ids   jsonb not null default '[]',    -- rolling entity focus
  updated_at  timestamptz not null default now()
);

-- Deny-all RLS, consistent with the rest of the schema: all access is server-side
-- via the service key. (Supabase's advisor flags the no-policy state; expected.)
alter table campaign_runtime enable row level security;
