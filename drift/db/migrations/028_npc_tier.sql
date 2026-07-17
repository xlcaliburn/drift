-- ── 028: pinned NPC combat tier ──────────────────────────────────────────────
-- HANDOFF_NPC_CANON.md Task A. A cast NPC had no stored combat capability, so
-- every combatStart naming them let the model re-pick their toughness — a named
-- boss (Calvo, T3) could re-spawn as a generic T1 mook in a later fight. Set
-- once from whichever tier they actually fought at (llm/applyPlan/combat.ts):
-- a canon match overrides both the model's pick and the net-worth clamp; an
-- un-tiered match gets stamped from the tier that ended up spawning.
alter table npcs add column if not exists tier text;
