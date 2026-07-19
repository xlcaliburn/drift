# STORY.md — the authored campaign layer (main questline, sidequests, prologue)

*Owner direction from playtest feedback (2026-07-18): "a single main
questline that has rich npc backstories woven in, and pre-created sidequests
as well, not just auto-generated ones." Companion to COMBAT_V2.md (the
prologue showcases both systems). **Machinery + Season One "FAULT LINE" are
FULLY SHIPPED (2026-07-18)** — see the build order below; only the prologue
(slice 4) remains.*

## Why (what playtests showed)

The procedural layer works — jobs generate, threads track, NPCs stay canonical —
but everything the player touches is *filler by construction*. There is no
authored arc: nothing to care about across sessions, no NPC whose backstory
PAYS OFF, no "what happens next." The season spine (FAULT LINE) exists only as
a clock. The fix is an AUTHORED layer on top of the procedural one — the
procedural board becomes the between-chapters economy, not the game.

## The invariant (unchanged)

The engine owns progression: chapter triggers, objective completion, reveals,
and rewards are engine data + engine detection. The narrator dramatizes beats
it is TOLD are active — it never decides what happens next in the main quest.
Authored content lives in the PACK (this is world data — Modularity M1's
boundary applies: `pack.storyline`, `pack.sidequests`, richer `pack.cast`).

## 1. The main questline — `pack.storyline`

**Shape: one season = one authored questline = 3 acts / ~9 chapters.** Each
chapter is authored data the existing quest machinery can run:

- `id`, `act`, `title`
- `trigger` — engine-checkable conditions to OPEN it (prior chapter done +
  any of: tenday reached, location arrival, faction rep threshold, NPC trust
  tier, a specific fact on the ledger). Same detection style as jobs.
- `cast` — AUTHORED cast entries referencing pack NPC ids (no generation).
  The cast-manifest rule applies: "use EXACTLY these people."
- `objectives` — ordered, reusing the Job objective kinds (travel / eliminate
  / survive / investigate / persuade / sabotage) plus the QUESTS-1b `report`
  kind (talk-to-NPC), which this effort finally forces us to build.
- `beats` — authored narrative directives fed to the narrator while the
  chapter is active (the backstoryPressure pattern: explicit, one at a time,
  marked delivered by the engine). This is where NPC backstory WEAVES in:
  a beat can be "Sereda lets slip she knew the player's patron before the
  war" — the reveal is authored data, not model improv.
- `choicePoint` (0-1 per chapter) — a real branch recorded as a FACT
  ("sided with the Chain at Coldharbor") that later chapters' triggers and
  beats can condition on. Branch light: choices change flavor/allegiance
  and 1-2 late-chapter variants, not a full tree.
- `reward` — payout tier + rep + optionally a unique item / crew unlock.

**Runtime:** a `storyline` slice on `campaign_runtime` (chapter states +
delivered beats + choice facts), advanced in the turn route exactly where jobs
advance today. Context: an `activeChapter` prompt section (like activeJobs,
but with the current beat directive). The Story tab shows act/chapter progress.

**Rich NPC backstories:** extend `PackNpc` with authored depth for storyline
cast — `backstory` (full paragraph, GM-truth), `secret` (the reveal), `arc`
(how they change per act), `voice`. Pack-authored values are set-once canon;
the generated-pool fallbacks stay for everyone else.

## 2. Authored sidequests — `pack.sidequests`

Same machinery as the board's jobs (Job schema + objectives + cast) but
authored and PLACED, not generated: each has a trigger (location + optional
act/rep/trust gate), a fixed cast of pack NPCs, authored complication, and a
one-shot flag. They surface diegetically exactly like board offers (the
offeredJobs section) — the player can't tell the seam, but these have real
faces, real stakes, and callbacks to the main cast. Target: 2-3 per location
for launch. The procedural board keeps running underneath for income filler.

## 3. The prologue — the tutorial becomes Chapter 0

Replace the organic "resolve 3 quests" tutorial with an AUTHORED prologue
chapter that showcases both combat systems (COMBAT_V2.md):

1. **Opening beat** — faction-specific (reuses the existing opening seeds),
   patron introduces a TEMPORARY ALLY (authored pack NPC, per faction).
2. **Ground fight** — scripted, forgiving (tutorial-safe rules already exist),
   WITH the ally as a controllable squad member: teaches attack/aim/cover,
   statuses, and issuing orders to a second character.
3. **Ship fight** — on the faction loaner, scripted weak opponent: teaches
   power allocation (guns vs shields vs systems) and the dice tradeoff.
4. **Graduation** — the ally departs (hook: they're storyline cast and
   return in Act 1 or 2 — the first authored backstory payoff), patron hands
   the player to the open world + chapter 1's trigger arms.

`inTutorial` becomes "prologue chapter not complete" instead of quest-count.

## Build order (each slice = one handoff)

1. ~~**QUESTS 1b `report` objective**~~ — SHIPPED 2026-07-18 (`HANDOFF_STORY_1.md`
   Task A): `ObjectiveKind` gained `report`, completed when the target NPC id is
   in `TurnSignals.presentNpcIds` — engine-verified presence, never a model
   self-report.
2. ~~**Storyline machinery**~~ — SHIPPED 2026-07-18 (`HANDOFF_STORY_1.md` Tasks
   B–D, fully annotated): the pack schema (`PackStoryline` et al.,
   `content/pack/drift/storyline.ts`), the pure engine (`shared/storyline.ts` —
   `evaluateTriggers`/`advanceStoryline`/`nextBeat`/`recordChoice`), the payout
   bridge (`shared/storylineRuntime.ts`), migration 031 + `lib/state.ts`
   normalization + turn-failure rollback safety, route wiring (trigger→advance→
   pay→mark-delivered, a `storyChoice` chip), the `activeChapter` prompt
   section (byte-identical golden — renders nothing while dormant), and the
   Story tab's "Season" block. Proven against a TEST-ONLY 2-chapter stub
   (`shared/storyline.test.ts`); **the live pack ships an empty storyline
   (dormant) until content lands** — every field of the machinery is exercised,
   but zero chapters are armed on any real campaign. `STORY_AUTHORING.md`
   (the owner-facing format guide) shipped alongside it.
3a. ~~**Content machinery**~~ — SHIPPED 2026-07-18 (`HANDOFF_STORY_2.md`,
   fully annotated). The build-order's old "content, not code" framing was
   wrong: three things the script depends on had no runtime — this slice
   built them. Authored cast depth is a PACK-ONLY live overlay
   (`content/pack/index.ts`'s `authoredCastDepth` — the seed cast loads from
   the DB npcs table, so `seedNpcs` was a dead end, and persisting `secret`
   would have leaked it to the client via `/api/state`); `backstory` is
   always-on + spoiler-safe (wins over the generated hook), `secret`/`arc`
   are chapter-gated (`promptSections/castReveals.ts`: chapter-active ∧
   cast-member ∧ present, arc picked by act). Sidequests
   (`shared/sidequests.ts`) are a thin wrapper on the Job machinery — placed,
   act/rep/trust/fact-triggered, one-shot for free (a completed/failed
   `sq-<id>` job persists in the jobs slice forever — no migration needed).
   Signature chapter rewards (`itemId` through the full-pack pendingPickup
   path, `crewUnlock` raising trust to recruit-eligible) ride the existing
   payout bridge. **Live pack ships zero authored depth and zero
   sidequests** — every field of the machinery is exercised against
   test-only stubs, dormant on every real campaign. A review pass caught and
   fixed one real correctness bug in the process: the personal-job
   arc-resolution gate (`shared/jobsRuntime.ts`) would have falsely
   "resolved" an arc that was never opened the first time a sidequest's
   giver was any NPC the player already had standing with — tightened to
   only fire for a job that genuinely opened as a personal favor.
3b. ~~**Authored content pass — SEASON ONE "FAULT LINE"**~~ — SHIPPED
   2026-07-18 (`HANDOFF_STORY_3.md`, fully annotated). Division of labor
   ADJUSTED from the original "Fable drafts, owner edits" (Fable budget):
   Fable locked the complete season SPINE in the handoff — the plot (the
   Hollow Crown's founding houses filed salvage claims on colony ships still
   in transit, then engineered the "accident" their debt empire was built
   on — the wrecked **Verity**, built from the canon Kesh/Wake/Reclaimers
   seeds), all 11 chapter entries (`content/pack/drift/storyline.ts` —
   ch-1..ch-8 shared spine + 3 fact-gated finale variants), every principal's
   secret and arc (`content/pack/drift.ts`: npc-ledger/ismay/kesh/ilyana/
   osk/brekk get full depth; npc-quist/broker get backstory only), and all
   12 sidequest specs (`content/pack/drift/sidequests.ts`) — and Sonnet
   expanded the PROSE inside those rails (directives, blurbs, backstory
   wording), never the structure. **This slice ENDS dormancy** — the three
   dormancy tests in `pack.test.ts` flip to structural pins (11 chapters in
   order, exactly two choicePoints, the three-way finale exclusivity, 12
   unique sidequest ids, the six-principal cast-depth split), and the
   context-slice golden re-pinned exactly once (authored `backstory` on
   `npc-broker` moved its `[hook: ...]` line — confirmed no other line
   moved). `validatePack(pack)` returns `[]` with the full season in.
   One deliberate deferral, noted for later: a single NEUTRAL opener (via
   the Ledger, canon "trusted by all sides") rather than per-faction
   opening variants — the trigger schema has no faction predicate and this
   slice added no code, so faction-flavored openings stay a future idea,
   not a gap in this season. Owner edits/tunes from here per
   `STORY_AUTHORING.md` — genuinely just pack-file edits, no code.
4. **Prologue** — COMBAT_V2 has landed, so this is unblocked; it rides after
   the content slice (Chapter 0 is content too).

## Decisions (RESOLVED 2026-07-18 — owner approved recommendations)

- **3 acts × 3 chapters; shared spine** — faction-flavored openings converge
  at Act 1's end.
- **Branching = flavor + allegiance + one branched finale**, recorded as
  facts; never parallel chapter trees.
- **Storyline cast CAN die mid-season** — the fate system records it; every
  beat referencing a mortal NPC carries an authored fallback variant.

### Second round (2026-07-18, pre-implementation)

- **Machinery first, stub story** — engine on tested rails before any script.
- **Fable drafts, owner edits** — the pack format is the editing surface;
  `STORY_AUTHORING.md` documents it. **Hot-editability is a design goal**:
  campaigns persist only progress POINTERS (chapter/beat/choice ids), content
  is read live from the pack each turn — prose/beat/reward edits apply
  immediately even to campaigns mid-chapter. Ids are forever; everything
  else is editable; the engine degrades gracefully on removed ids.
- **Retrofit live campaigns** — triggers are state PREDICATES re-evaluated
  every turn (never event-edges), so existing campaigns qualify naturally
  the moment content ships.
- **Patient pacing** — an open chapter surfaces and WAITS (activeChapter
  directive + Story tab + a nudge after ~3 quiet tendays); it never hijacks
  the sandbox.
