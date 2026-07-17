-- 025_runtime_facts: the FACTS LEDGER (CONTINUITY.md v2, D-2) — durable standing
-- facts that outlive scenes (struck deal terms, appointments, bans, debts).
-- Engine-owned session slice like jobs/npc_relations: the model PROPOSES facts
-- (TurnPlan.facts), the engine caps at 20, dedupes (a restated fact replaces its
-- older wording), and feeds them back every turn as canon. Born from the audit
-- pattern: "narrated deal terms have no durable home, so later scenes contradict
-- them" (the live 50/50 → 30% renegotiation, the overwritten Rust Bucket meet).

alter table campaign_runtime add column if not exists facts jsonb not null default '[]'::jsonb;
