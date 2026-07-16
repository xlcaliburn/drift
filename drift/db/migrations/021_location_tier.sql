-- 021_location_tier — danger band on a canonical location (LOCATIONS.md Phase 2a).
-- Optional: when NULL the app derives it from tags (shared/locations.ts). An explicit
-- value is a hand-set override — e.g. Rook is a STARTING station, so it's pinned T1
-- (secure) even though its blackmarket/lawless tags would derive T2.
alter table locations
  add column if not exists tier text check (tier in ('T1','T2','T3'));
