-- 020_runtime_ledger — the relationship ledger (MULTIPLAYER.md §2).
-- A per-campaign "who-knows-what" Rolodex over the shared dossiers: which other
-- players' characters (and, later, NPCs) this character has actually MET (firsthand),
-- keyed by subject characterId. Like npcs / scene_card / npc_relations / jobs it's a
-- SESSION slice (engine-owned, per-campaign), so it lives on campaign_runtime as jsonb
-- rather than a relational table. Only firsthand entries are stored; secondhand
-- knowledge is derived from the subject's public deeds + a shared faction.
alter table campaign_runtime
  add column if not exists player_ledger jsonb not null default '{}'::jsonb;
