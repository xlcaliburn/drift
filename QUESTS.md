# QUESTS.md — the procedural Job Board

*PHASE 1 SHIPPED (2026-07-15): an engine-owned, playstyle-weighted **job board** of
structured "scores" the ENGINE assembles, tracks, and pays out — so quest STRUCTURE
stops depending on DeepSeek carrying it in free-text threads. The engine builds each
job from parts, DETECTS completion from the turn's real signals (where you are, a
won fight, a successful skill roll), and pays a guaranteed reward. The narrator only
writes prose over engine-decided beats. This doc is the reference for how jobs work.*

## The one invariant (same as everywhere)

The engine owns the job: its steps, its completion detection, its payout. The LLM
never decides a job is done and never hands over credits — it dramatizes the next
step the engine is tracking. A job's reward is rolled from the tier band
(`rollJobCredits`, same bands as `award_payout`), so a quest can't leak money the
economy ramp wouldn't allow.

## Locked decisions

- **Engine owns steps + rewards.** Objectives and payout are engine data, not model
  output. (AskUserQuestion-locked with the owner.)
- **Procedural from parts.** Jobs are assembled from archetype skeletons ×
  cargo/target/faction/location/complication pools — not hand-authored, not
  model-authored. Inspiration: Blades in the Dark *scores*, a radiant job board, and
  faction lines.
- **One board, playstyle-weighted.** A single board, biased toward the PC's `bias`
  (playstyle) and their stated `directive`, but anyone can take anything — a couple
  of off-lean jobs always appear. Not separate per-playstyle trees.
- **Hybrid completion, Phase 1a = auto-detect only.** The engine detects completion
  from state alone (arrival, combat outcome, a matching skill success). The
  model-signalled "report back" step lands in 1b.
- **Board sourced from panel + NPC.** `giver` is `"board"` for now; NPC-given jobs
  come in 1b.
- **Flat faction rep first.** A job that carries a faction pays `repDelta` on
  completion; deeper faction arcs come later.
- **Jobs are a session slice**, stored as `jsonb` on `campaign_runtime.jobs` (like
  `npcs` / `sceneCard` / `npcRelations`), not a relational table — they're
  per-campaign, engine-owned, and rewritten every turn. Migration `019_runtime_jobs`.

## Where it lives

- `shared/quests.ts` — PURE core: the `Job`/`Objective` Zod schemas, the 8
  `ARCHETYPES` (courier / smuggling / bounty / protection / heist / recon / broker /
  salvage) + parts pools, `generateJob` (bias+directive weighted, reward tier clamped
  DOWN to `payoutCeiling` so a rookie can't draw a major score), `refreshBoard`,
  `acceptJob` / `abandonJob`, `turnSignals`, `advanceJobs` (the engine-owned tracker
  — advances ONE objective/turn, flags completions), `rollJobCredits`. No DB, no
  engine class → never collides with the engineBridge split, fully unit-tested
  (`quests.test.ts`).
- `shared/jobsRuntime.ts` — the thin PURE bridge from a resolved turn to the board:
  `resolveJobsTurn` (advance → pay credits + faction rep for completions → top the
  board up) and `applyJobClick` (accept/abandon + top-up). Tested by
  `jobsRuntime.test.ts`.
- `app/api/turn/route.ts` — post-turn hook: folds any accept/abandon click in, then
  `resolveJobsTurn` over `turnSignals(currentLocationId, events, combatResolvedAlive)`.
  The mutated state (credits/rep) + 🎯 lines + board ride the same persist +
  `done` payload as everything else. Stays OUT of `engineBridge`/`runtime*`/
  `applyPlan` so it can't collide with the in-flight engine split.
- `app/api/state/route.ts` — seeds the board on first read (only when empty) so the
  Jobs tab has offers before the first turn; exposes `jobs`.
- `components/sidebar/JobsTab.tsx` — the **Jobs** rail tab: "On the job" (active,
  per-objective progress, drop) + "Job board" (offered, tier badge, complication,
  Take it). Accept/abandon fire a normal turn carrying `acceptJob`/`abandonJob`
  (forwarded generically by `PlayClient`, like every other chip field).
- `llm/promptSections/quests.ts` — the `activeJobs` context section: feeds the
  narrator each active job's NEXT step ("weave it in; the engine tracks completion
  and pays — never declare a job done yourself"). Offered jobs stay on the
  player-facing board, out of the prompt, to keep the slice lean.

## Objective kinds (Phase 1a — engine-verifiable from state alone)

| kind | completes when |
|------|----------------|
| `travel` / `deliver` | `currentLocationId` == the objective's `locationId` |
| `eliminate` / `survive` | a fight resolved this turn with the PC alive |
| `investigate` / `persuade` / `sabotage` | a SUCCESS on one of the objective's `requiredSkills` this turn |

Objectives complete **in order**, one step per turn — a two-step bounty (track →
kill) needs arrival first, then the won fight.

## What's LEFT (Phase 1b+)

- **Model-signalled steps** — a `report`/`deliver-to-NPC` objective the narrator can
  flag done (hybrid completion's second half), for beats the engine can't see in
  state.
- **Inventory-tracked cargo** — `deliver` actually carries an item, lost if you die.
- **NPC-given jobs** — `giver` = an NPC id; the board surfaces jobs a present
  contact offers, not just the panel.
- **Faction arcs** — standing thresholds unlock higher-tier faction lines; ties into
  MULTIPLAYER.md dossiers/ledgers and the season Fault-Line.
- **Board top-up cadence tuning** — currently a flat board of 4, refreshed each turn
  with a 3-tenday offer expiry; revisit after a playtest cycle.
