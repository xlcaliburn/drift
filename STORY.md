# STORY.md — the authored campaign layer (main questline, sidequests, prologue)

*DESIGN (2026-07-18, Phase 1 — owner direction from playtest feedback: "a single
main questline that has rich npc backstories woven in, and pre-created
sidequests as well, not just auto-generated ones"). Companion to COMBAT_V2.md
(the prologue showcases both systems). Nothing built yet.*

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

1. **QUESTS 1b `report` objective** (small, unblocks everything authored).
2. **Storyline machinery** — schemas, runtime slice, trigger/advance engine,
   activeChapter section, Story tab. Testable with a 2-chapter stub.
3. **Authored content pass** — the actual season-one script (owner + Fable
   writing session: 9 chapters, ~12 sidequests, cast depth). Content, not code.
4. **Prologue** — after COMBAT_V2 lands (it demos those systems).

## Open decisions (owner)

- Act/chapter count (default: 3 acts × 3 chapters) and whether the questline
  is faction-specific in Act 1 (recommended: shared spine, faction-flavored
  openings converge at Act 1's end) vs fully shared.
- How hard choice points diverge (recommended: flavor + allegiance + one
  branched finale, not parallel chapter trees).
- Whether main-quest deaths of storyline cast are allowed mid-season
  (recommended: yes — the fate system records it; beats carry a fallback).
