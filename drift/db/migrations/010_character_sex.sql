-- ── 006: character sex (male/female) ───────────────────────────────────────
-- Backs the required Male/Female selection added to character creation
-- (components/CreateWizard.tsx + shared/multiplayer.ts CreationInput). The value
-- is stored on the character sheet and mapped automatically by db/queries.ts
-- (toRow/fromRow — 'sex' needs no snake/camel conversion).
--
-- Nullable + CHECK-guarded: legacy characters created before this migration keep
-- a NULL sex (the Character schema treats it as optional), while every new
-- character must supply 'male' or 'female' at the app layer.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).

alter table characters
  add column if not exists sex text
  check (sex is null or sex in ('male', 'female'));
