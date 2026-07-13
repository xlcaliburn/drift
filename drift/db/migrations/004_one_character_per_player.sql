-- ── 004: one character (campaign) per player ───────────────────────────────
-- Backs the API/UI rule (app/api/create/route.ts, app/create/page.tsx) with a
-- storage-layer guarantee so a second character can't be created by any path.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Admins are intentionally allowed multiple worlds (seeded/unowned campaigns),
-- so the constraint is scoped to owned rows only — a partial unique index on a
-- non-null player_id. Admin-held campaigns each still have a distinct player_id
-- (one each), so this does not restrict them; it only blocks a single player_id
-- from owning two.

-- 1) Resolve any EXISTING duplicates NON-DESTRUCTIVELY before the index can be
--    created. For each player, keep their OLDEST campaign (the original) and
--    orphan the rest (player_id -> NULL). Orphaned worlds are hidden from the
--    player's list but remain in the DB, admin-visible, and fully recoverable by
--    setting player_id back. No rows are deleted.
--
--    If you would rather HARD-DELETE the extra campaign(s) instead of orphaning
--    them, replace this UPDATE with the DELETE in the comment block below.
update campaigns c
set player_id = null
where c.player_id is not null
  and exists (
    select 1 from campaigns o
    where o.player_id = c.player_id
      and (o.created_at < c.created_at
           or (o.created_at = c.created_at and o.id < c.id))
  );

-- Destructive alternative (removes the duplicate campaign + all its cascaded
-- rows — characters, ships, rep, clocks, threads, scenes, turns, rolls):
--   delete from campaigns c
--   where c.player_id is not null
--     and exists (
--       select 1 from campaigns o
--       where o.player_id = c.player_id
--         and (o.created_at < c.created_at
--              or (o.created_at = c.created_at and o.id < c.id))
--     );

-- 2) Enforce going forward: at most one campaign per (non-null) player_id.
create unique index if not exists uniq_campaigns_one_per_player
  on campaigns (player_id)
  where player_id is not null;
