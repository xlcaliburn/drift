-- ── 026: fixed NPC physical description ─────────────────────────────────────
-- Live failure: the narrator re-invented an NPC's body scene to scene (scarred
-- one scene, unmarked the next). Like quirk/backstory (016), each NPC gets a
-- STABLE, engine-generated (deterministic, seeded off id) physical description —
-- build + face + one distinguishing mark — universe-shared so the same person
-- looks the same for every player. Backfill is render-time (world.ts falls back
-- to generateAppearance(id)) and persist-on-touch (registerNpc, set-once), so no
-- data migration is needed here.
alter table npcs add column if not exists appearance text;
