-- 024_daily_audits: the nightly Opus continuity-audit pass (one report per
-- campaign per day, ~3am). The report jsonb holds the full structured audit:
-- storyContext, inconsistencies[], droppedThreads[], frustrations[] (incl.
-- appeals), adjustments[]; `applied` records which continuity updates
-- (npc/thread reconciliations) were auto-folded into the live session.
-- RLS deny-all like everything else — all access is server-side via the
-- service key; reports surface only through /admin.

create table if not exists daily_audits (
  id          bigint generated always as identity primary key,
  campaign_id text not null,
  audit_date  date not null,
  model       text not null,
  report      jsonb not null,
  applied     jsonb,
  cost_usd    numeric,
  created_at  timestamptz not null default now(),
  unique (campaign_id, audit_date)
);

create index if not exists daily_audits_date_idx on daily_audits (audit_date desc);

alter table daily_audits enable row level security;
