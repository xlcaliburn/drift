-- ── 016: canonical NPC personality + backstory ─────────────────────────────
-- Each NPC gets a stable, engine-generated (deterministic, seeded off id) quirk
-- and a light backstory hook. Universe-shared like the NPC itself, so the same
-- character reads the same for every player who meets them, and future quests can
-- hang off the backstory.
--   quirk     — a demeanor + a tell the narrator plays consistently.
--   backstory — a want + a complication; a latent quest hook.
-- Set once at registration; per-player standing stays in npc_relations. Safe to re-run.

alter table npcs add column if not exists quirk text;
alter table npcs add column if not exists backstory text;
