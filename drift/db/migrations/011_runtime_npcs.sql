-- ── 011: campaign-scoped NPCs on the runtime snapshot ──────────────────────
-- The npcs table is UNIVERSE-scoped (shared across every campaign in a world),
-- so narrator-introduced NPCs and creation relations can't be written there
-- without leaking one player's cast into everyone else's game. Instead they live
-- on the per-campaign runtime snapshot (like transcript/history/combat) and are
-- merged back into state on load. Safe to re-run.

alter table campaign_runtime add column if not exists npcs jsonb not null default '[]'::jsonb;
