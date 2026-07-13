-- Multi-turn combat: persisted per-campaign combat state (enemies, round, buffs),
-- scene-scoped runtime data alongside transcript/history. Null when not in a fight.
alter table campaign_runtime add column if not exists combat jsonb default null;
