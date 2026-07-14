-- ── 014: universe-shared generated NPCs ────────────────────────────────────
-- NPCs generated during play (registerNpc) and the 1–2 backstory NPCs seeded at
-- character creation are promoted into the UNIVERSE-scoped npcs table so every
-- campaign in the same world can meet them (shared narrative canon). Two new
-- columns support this:
--   role               — an occupational handle ("data broker"); the UI shows it
--                        when a player doesn't yet know the NPC's name.
--   origin_campaign_id — provenance: which campaign first spawned the NPC. Nulled
--                        (not cascade-deleted) if that campaign is removed, so the
--                        shared cast survives. Per-player standing stays private in
--                        campaign_runtime.npc_relations and never lands here.
-- Safe to re-run.

alter table npcs add column if not exists role text;
alter table npcs
  add column if not exists origin_campaign_id text
  references campaigns(id) on delete set null;
