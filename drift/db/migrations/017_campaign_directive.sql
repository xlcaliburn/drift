-- 017_campaign_directive: the player's own stated AIM for their character
-- (e.g. "dig into people and build relationships", "get rich trading"). Fed to
-- the narrator every turn so the world bends toward what THIS player enjoys
-- instead of forcing an unrelated questline. Free text, player-editable, nullable.
alter table campaigns add column if not exists directive text;
