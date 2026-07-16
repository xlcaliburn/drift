-- CREW.md slice 1: crew metadata on characters. A recruit (kind 'party') carries
-- the role they were hired for, the tier they were built from, and their wage per
-- TENDAY (charged by the engine as the clock advances — engine/time.ts). Absent
-- (null) on PCs and legacy characters.
alter table characters add column if not exists crew_role text;
alter table characters add column if not exists crew_tier text;
alter table characters add column if not exists wage int;
