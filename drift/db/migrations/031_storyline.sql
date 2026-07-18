-- 031_storyline — the authored main questline runtime slice (HANDOFF_STORY_1
-- Task C). A session slice like jobs / scene_card / npc_relations: engine-
-- owned, per-campaign, PROGRESS POINTERS ONLY (chapter/beat/choice ids,
-- counters) — never copies of pack content, so a content edit applies live
-- (STORY.md's hot-editability goal). Dormant on every campaign until the
-- pack ships chapters (empty live storyline, HANDOFF_STORY_1 trap 3).
alter table campaign_runtime
  add column if not exists storyline jsonb not null default '{}'::jsonb;
