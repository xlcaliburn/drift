-- 032_prologue_stage — HANDOFF_STORY_4.md. The authored prologue's stage
-- (intro/groundFight/shipFight/graduation/complete), a plain column on the
-- campaign row like directive/last_backstory_beat_tenday, not a runtime jsonb
-- slice. NULL = a legacy campaign: shared/tutorial.ts's OLD quest-count rule
-- applies unchanged, no ally, no directive, no pause. Zod (Campaign.prologueStage)
-- owns the enum validation, same as `status` — no CHECK constraint here.
alter table campaigns
  add column if not exists prologue_stage text;
