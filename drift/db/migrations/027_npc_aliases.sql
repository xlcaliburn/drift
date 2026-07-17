-- 027_npc_aliases: alternate names an NPC is known by (CHECKS.md §2). Born from
-- the Lyra Ren/Renwick tangle: the cast record was named "Ren (fixer)" while the
-- prose called the same man "Renwick" — retrieval, presence, and dedupe all key
-- on record names, so the narrator's own vocabulary and its memory index
-- disagreed about who existed, and a "Renwick" mention could fork a FOURTH Ren.
-- Aliases make every known name of a person resolve to the same record.

alter table npcs add column if not exists aliases jsonb;
