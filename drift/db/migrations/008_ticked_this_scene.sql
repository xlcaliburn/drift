-- Per-scene skill-tick cap now spans turns (ticks are awarded immediately on a
-- qualifying roll instead of batched to end_scene). Persist which skills already
-- ticked this scene ("characterId:skill" keys) so the cap survives cold loads.
alter table campaign_runtime add column if not exists ticked_this_scene jsonb not null default '[]';
