-- 023_backstory_pressure — BACKSTORY.md Phase 1. Tracks the tenday value at which a
-- backstory beat (an NPC tie, ambition, or moral code) last surfaced in play, so the
-- engine can force one after enough silence (shared/backstoryPressure.ts). Mirrors
-- tendays_elapsed/directive: a plain column on the campaign, not a runtime jsonb
-- slice, since it's simple scalar bookkeeping alongside campaign metadata.
alter table campaigns
  add column if not exists last_backstory_beat_tenday integer;
