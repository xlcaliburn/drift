-- ── 013: retain the last offered choices across a refresh ───────────────────
-- The suggested-action chips were recomputed only on a live turn, so a browser
-- refresh dropped them until the next turn. Persist the last set on the runtime
-- snapshot so reload restores them. Safe to re-run.

alter table campaign_runtime add column if not exists last_choices jsonb not null default '[]'::jsonb;
