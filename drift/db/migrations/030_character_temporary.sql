-- ── 030: temporary party members ─────────────────────────────────────────────
-- HANDOFF_COMBAT_V2_1.md Task C. A story-granted party member (STORY.md's
-- prologue ally, etc.) is a normal kind:"party" character in every other way
-- (controllable in squad orders, can be downed, fate rules apply) except
-- chargeCrewUpkeep skips them — no wages, since they were never hired.
alter table characters add column if not exists temporary boolean;
