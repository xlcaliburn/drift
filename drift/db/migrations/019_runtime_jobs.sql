-- 019_runtime_jobs — the procedural job board (QUESTS.md).
-- Jobs are a SESSION slice like npcs / scene_card / npc_relations (engine-owned,
-- per-campaign, mutated every turn), so they live on campaign_runtime as jsonb
-- rather than a relational table. Offered + active + recently-completed scores.
alter table campaign_runtime
  add column if not exists jobs jsonb not null default '[]'::jsonb;
