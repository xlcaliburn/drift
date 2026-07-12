-- ── 003_ai_audit: per-call AI audit log ────────────────────────────────────
-- Every model call (narrator turn, character finalize, scene summary) writes one
-- row here so the AI path is inspectable: latency, tokens, cost, which tools ran,
-- how many round-trips, whether we fell back, and a TRUNCATED prompt/response.
-- Distinct from turn_usage (budget accounting): this is observability/debugging,
-- kept per-call rather than aggregated. Safe to re-run.
--
-- We store only truncated prompt/response previews (see AUDIT_PREVIEW_CHARS in
-- lib/audit.ts), not full transcripts — enough to debug length/latency without
-- retaining whole conversations.
create table if not exists ai_calls (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references profiles(id) on delete set null,  -- null for dev/keyless
  campaign_id        text,                                             -- no FK: survives deletion
  kind               text not null,                                    -- 'turn' | 'creation' | 'summary'
  model              text not null,
  latency_ms         int not null default 0,
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd           numeric(10,6) not null default 0,
  rounds             int,                                              -- model round-trips (turn loop)
  tool_calls         text[],                                           -- tool names invoked, in order
  stop_reason        text,
  fell_back          boolean not null default false,                  -- cheap provider errored -> Haiku
  system_chars       int,                                              -- size of system prompt (not stored verbatim)
  prompt_preview     text,                                             -- truncated player/user input
  response_preview   text,                                             -- truncated model output
  error              text,                                             -- set when the call failed
  created_at         timestamptz not null default now()
);
create index if not exists idx_ai_calls_time on ai_calls(created_at desc);
create index if not exists idx_ai_calls_user_time on ai_calls(user_id, created_at desc);
create index if not exists idx_ai_calls_campaign on ai_calls(campaign_id, created_at desc);

-- Service-role only (admin reads/writes via the service client, which bypasses
-- RLS). No player-facing policies: enabling RLS with none denies anon/auth reads.
alter table ai_calls enable row level security;
