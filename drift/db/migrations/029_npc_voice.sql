-- ── 029: pinned NPC speech pattern ───────────────────────────────────────────
-- HANDOFF_NPC_CANON.md Task C. Quirk pins demeanor+tell but not HOW an NPC
-- talks (sentence rhythm, formality, slang), so the same dockworker could speak
-- like a poet one scene and a soldier the next. Set once from
-- shared/npcFlavor.ts generateVoice (deterministic off id, universe-shared —
-- same pattern as quirk/backstory/appearance). Age has NO new column — it's
-- folded into the existing `appearance` text (generateAppearance).
alter table npcs add column if not exists voice text;
