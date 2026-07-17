-- ── 027: pinned NPC sex ──────────────────────────────────────────────────────
-- Same class as the PC sex pin: NPCs carried no stored sex, so the narrator
-- re-decided pronouns from the NAME every scene and could regender the same
-- person mid-story. Captured FROM the fiction (the pronouns the narration itself
-- first used — shared/npcExtract.ts inferNpcSex), set once, universe-shared, and
-- fed back on every NPC context line. Never guessed from the name; absent until
-- the narration establishes it. (npcs.status already exists for the fate write.)
alter table npcs add column if not exists sex text;
