# QUESTS.md — the procedural Job Board

*PHASE 1 SHIPPED (2026-07-15): an engine-owned, playstyle-weighted **job board** of
structured "scores" the ENGINE assembles, tracks, and pays out — so quest STRUCTURE
stops depending on DeepSeek carrying it in free-text threads. The engine builds each
job from parts, DETECTS completion from the turn's real signals (where you are, a
won fight, a successful skill roll), and pays a guaranteed reward. The narrator only
writes prose over engine-decided beats. This doc is the reference for how jobs work.*

*UPDATE 2026-07-16 — **diegetic offers + job coherence**: the browsable Jobs rail
tab is REMOVED. Offers now surface only through the fiction (the `offeredJobs`
context section feeds them to the narrator; a fixer's pitch, dock chatter, a notice)
and are taken via a narrator choice carrying `acceptJob:"<id>"` — with a typed-accept
backstop (`inferJobAccept`) for when the model under-fires the field. Active jobs
show in a compact "On the job" block on the Status tab. Generation gained an
ALIGNMENT model so jobs stop reading as nonsense ("Hollow Crown pays you to smuggle
past the Hollow Crown watch"): givers must plausibly offer the work, adversarial
archetypes get a distinct opponent, and the player's faction biases what they see.*

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
- **Offers are DIEGETIC, not a menu.** No browsable board UI — the narrator surfaces
  the engine's offers through the world and the player takes them in the fiction.
  The engine still owns every offer's structure, pay, and expiry.
- **Coherence via alignment.** Every archetype has an alignment (`official` /
  `underworld` / `neutral`) and every canon faction a character (`FACTION_ALIGNMENT`:
  Crown + Undertow official, Sable + Wreckers underworld, Free + Reclaimers neutral).
  `canOffer` gates who can post what — officials never post smuggling/heists,
  syndicates never run sanctioned bounty desks. Adversarial archetypes (smuggling,
  heist — where `{faction}` is the OPPONENT) resolve that placeholder to a faction
  that is never the giver, preferring one of the opposite character. The giver
  strongly prefers the PLAYER's own faction when eligible (weight 4:1), and the
  player's faction alignment leans the archetype mix (+2) — a Hollow Crown hand sees
  mostly sanctioned work, a Sable runner more smuggling; off-lean work still appears.
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
- `app/api/state/route.ts` — seeds the board on first read (only when empty) so
  offers exist before the first turn; exposes `jobs`.
- `components/sidebar/StatusTab.tsx` — the compact **"On the job"** block (title,
  next objective, progress count, drop). The old browsable `JobsTab` is DELETED —
  offers are diegetic now. Accept/abandon ride a normal turn carrying
  `acceptJob`/`abandonJob` (a narrator-emitted choice's fields forward generically
  through `PlayClient`, like every other chip field).
- `llm/promptSections/quests.ts` — TWO context sections: `activeJobs` (each active
  job's NEXT step: "weave it in; the engine tracks completion and pays — never
  declare a job done yourself") and `offeredJobs` (the offers posted HERE, with ids —
  "surface through the world, never as a menu; the take-it choice must carry
  acceptJob:'<id>'"). Rule 8 in `jsonSystem.ts` backs this: paid work comes ONLY
  from the WORK ON OFFER list — the model never invents a different paying job.
- `shared/quests.ts` `inferJobAccept` — the typed-accept backstop, wired in
  `app/api/turn/route.ts`: an accept VERB + a distinctive title/archetype token
  matching exactly ONE offer flips it deterministically even when the model's
  choice under-carried `acceptJob`. Ambiguous (two matches) → no accept.

## Objective kinds (Phase 1a — engine-verifiable from state alone)

| kind | completes when |
|------|----------------|
| `travel` / `deliver` | `currentLocationId` == the objective's `locationId` |
| `eliminate` / `survive` | a fight resolved this turn with the PC alive |
| `investigate` / `persuade` / `sabotage` | a SUCCESS on one of the objective's `requiredSkills` this turn |

Objectives complete **in order**, one step per turn — a two-step bounty (track →
kill) needs arrival first, then the won fight.

## Emergent-quest continuity backstop (SHIPPED 2026-07-15)

The procedural board is engine-owned, but EMERGENT quests — an NPC hands the player
a multi-step job in conversation — still ride the narrator's `threads:[]`, and the
cheap model under-fires it. A live case (Silas Cray) ran a Fingers→Yarl→loot-a-ship
chain for dozens of turns with ZERO threads opened, so it fell out of the history
window and was lost. Fix: the **scene analyst** (`llm/summarizer.ts`) now also
reconciles quest threads — it's fed the OPEN THREADS list and, reviewing the closed
(or mid-) scene, emits `threads:[{op:"open",title,body}]` for an objective the player
committed to that isn't tracked, and `{op:"resolve",id}` for one the scene finished.
Applied via `llm/threadReconcile.ts` (`applyThreadUpdates`) with the same light dedup
as the live path (`applyPlan/world.ts`). A reasoning model reviewing concrete
outcomes → low false-positive; the live `threads:[]` path stays primary.

## What's LEFT (Phase 1b+)

- **Model-signalled steps** — a `report`/`deliver-to-NPC` objective the narrator can
  flag done (hybrid completion's second half), for beats the engine can't see in
  state.
- ~~**Inventory-tracked cargo**~~ — SHIPPED 2026-07-16: delivery jobs stamp `cargo`;
  on accept it becomes a jobId-tagged gear item (slot-free — hauled, not packed;
  unsellable), and the ENGINE consumes it with a 📦 line when the deliver objective
  completes (abandon forfeits it). Born from the Wren audit's core that was sold AND
  delivered AND still carried. Still open from the original idea: lost on death.
- **NPC-given jobs** — `giver` = an NPC id; the board surfaces jobs a present
  contact offers, not just the panel.
- ~~**Quest CAST MANIFESTS**~~ — SHIPPED 2026-07-18 (HANDOFF_NPC_CANON Task D):
  each archetype has a FIXED cast of `CastSlot`s (courier: `{giver}`; smuggling:
  `{giver, contact}`; bounty: `{giver, target}`; protection: `{giver, ward}`;
  heist: `{giver, contact}`; recon: `{giver}`; broker: `{giver, target}`; salvage:
  `{giver}`) — `generateJob` decides WHO fills each slot (deterministic name via
  `suggestName`, collision-avoided against the whole world) the moment the job is
  generated, stored on `Job.cast`. `{target}` in objective summaries now resolves
  to the cast target/ward's real NAME, not a flavor-text pool pick. Real NPC
  records are only created on ACCEPT (`materializeJobCast`, idempotent) — an
  untaken board posting never bloats the cast. `generatePersonalJob` swaps the
  generated giver for the REAL npc (no phantom duplicate). Context feed: active
  jobs list their cast with role/name/occupation/home-station ("use EXACTLY these
  people, invent no one else for this job"); offers name the giver in the pitch.
  Kills the live failure where a running job accreted 4-5 model-invented randos
  (a live audit found 8-of-22 thin "Spoke with the player" cast shells on one
  campaign): a quest's people are constants like its objectives and payout, with
  the model free on personality and dialogue, never on WHO exists. Still open:
  the reusable pregenerated pool for INCIDENTAL (non-quest) figures.
- **Faction arcs** — standing thresholds unlock higher-tier faction lines; ties into
  MULTIPLAYER.md dossiers/ledgers and the season Fault-Line.
- **Board top-up cadence tuning** — currently a flat board of 4, refreshed each turn
  with a 3-tenday offer expiry; revisit after a playtest cycle.
