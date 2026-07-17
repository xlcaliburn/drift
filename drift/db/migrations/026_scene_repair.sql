-- 026_scene_repair: self-healing scene memory (CONTINUITY.md). When the scene
-- analyst fails, the F-3 deterministic stub keeps the row from being a hole —
-- but it used to be a PERMANENT stub (the Lyra campaign: 12 of 14 summaries
-- junk, the narrator improvising over the missing tier). Now a failed
-- compression is stamped `degraded` and keeps its raw transcript slice, so a
-- later pass (next scene close / manual re-sync) can re-run the analyst from
-- the preserved source text and replace the stub with a real summary.

alter table scenes add column if not exists degraded boolean not null default false;
alter table scenes add column if not exists raw_slice text;
