-- ── 012: scene memory (CONTINUITY.md) ───────────────────────────────────────
-- Tier NOW + CANON live on the per-campaign runtime snapshot:
--   scene_card    — the current scene's working memory (seq, turn count, who's
--                   present, situation, beats, transcript start index).
--   npc_relations — the player's standing per NPC id (relationship, disposition,
--                   last-interaction note). Campaign-side overlay: seed NPCs are
--                   universe-shared and are never mutated per player.
-- Tier RECENT (scene summaries) reuses the existing `scenes` table.
-- Safe to re-run.

alter table campaign_runtime add column if not exists scene_card jsonb;
alter table campaign_runtime add column if not exists npc_relations jsonb not null default '{}'::jsonb;
