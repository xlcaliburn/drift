-- ── 005: correct the duplicate-character keeper policy ─────────────────────
-- Supersedes migration 004's keeper ranking. 004 resolved duplicate campaigns
-- by keeping each player's OLDEST campaign; that's wrong — an accidental early
-- throwaway would shadow the world the player actually invested in. The keeper
-- should be the MOST-PROGRESSED campaign instead, matching db/queries.ts
-- getOwnedCampaign so the UI and the storage layer always agree on which world
-- a player is sent to.
--
-- Run in the Supabase SQL editor AFTER 004. Safe to re-run, and non-destructive:
-- losers are orphaned (player_id -> NULL), never deleted. If 004 already ran and
-- left no duplicates (the partial unique index it created prevents new ones),
-- this UPDATE is a harmless no-op. It only re-homes rows in the rare case a
-- duplicate still exists at the moment this runs.
--
-- "Most-progressed" ranking (highest wins):
--   1. resolved quests   — threads.status = 'resolved' count, desc
--   2. in-game time      — campaigns.tendays_elapsed, desc
--   3. oldest            — campaigns.created_at asc (stable final tiebreak)
--   4. id                — asc (deterministic backstop for exact ties)

-- 1) Re-resolve any remaining duplicates NON-DESTRUCTIVELY, keeping each
--    player's most-progressed campaign and orphaning the rest.
with ranked as (
  select c.id,
         row_number() over (
           partition by c.player_id
           order by (select count(*) from threads t
                       where t.campaign_id = c.id and t.status = 'resolved') desc,
                    c.tendays_elapsed desc,
                    c.created_at asc,
                    c.id asc
         ) as rn
  from campaigns c
  where c.player_id is not null
)
update campaigns c
set player_id = null
from ranked r
where c.id = r.id
  and r.rn > 1;

-- Destructive alternative (removes the non-kept campaign(s) + all cascaded rows —
-- characters, ships, rep, clocks, threads, scenes, turns, rolls):
--   with ranked as (
--     select c.id,
--            row_number() over (
--              partition by c.player_id
--              order by (select count(*) from threads t
--                          where t.campaign_id = c.id and t.status = 'resolved') desc,
--                       c.tendays_elapsed desc,
--                       c.created_at asc,
--                       c.id asc
--            ) as rn
--     from campaigns c
--     where c.player_id is not null
--   )
--   delete from campaigns c using ranked r where c.id = r.id and r.rn > 1;

-- 2) The partial unique index (uniq_campaigns_one_per_player) was already created
--    in 004; guarded here as a no-op backstop in case 005 is run against a DB
--    where 004's index step did not complete.
create unique index if not exists uniq_campaigns_one_per_player
  on campaigns (player_id)
  where player_id is not null;
