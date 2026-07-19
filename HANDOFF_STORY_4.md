# HANDOFF — Story slice 4: THE PROLOGUE — the tutorial becomes an authored Chapter 0

*Strategy phase output (Fable, 2026-07-18). **FULLY SHIPPED 2026-07-18** —
this slice closes out STORY.md's entire roadmap; see the per-task
annotations below and STORY.md/STATUS.md/CLAUDE.md for the shipped-record
summaries. Read `WORKFLOW.md` first, then this doc fully. Design source:
`STORY.md` §3, adapted to the machinery as it actually shipped. This is a
MACHINERY + light-content slice: a new authored prologue track (NOT a
storyline chapter — see decision 1), a persisted stage on the campaign,
the temporary-ally lifecycle migration 030 was built for, and the
`inTutorial` redefinition. Every structural decision is LOCKED below;
prose (directives, ally flavor) is the implementer's within the style
sheet of HANDOFF_STORY_3.*

## Decisions already made (do not re-litigate)

1. **The prologue is NOT a `pack.storyline` chapter.** No trigger predicate
   can distinguish a new campaign from a veteran one — a "ch-0" would open
   on every LIVE campaign (a tutorial for veterans) or, gated behind it,
   strand ch-1 for everyone. The prologue is its own track:
   `pack.prologue` + a persisted `Campaign.prologueStage`.
2. **Stage lives ON the campaign row** (`campaigns.prologue_stage`,
   migration — reconcile the number at build time). `Campaign` zod gains
   `prologueStage?: string` (optional → legacy rows parse untouched). It
   rides the EXISTING campaign row mappers; `saveCampaignState` already
   persists campaign-row changes.
3. **`undefined` stage = LEGACY campaign = the OLD rules apply,
   unchanged.** `inTutorial` becomes: stage set → `stage !== "complete"`;
   stage unset → the existing resolved-thread-count rule. Same for
   `graduatedTutorialThisTurn` (stage transition vs count crossing). This
   preserves EXACT current behavior for every live campaign — including
   any still inside the old quest-count tutorial — with zero backfill.
4. **The ally is a CHARACTER, not an NPC.** Migration 030's `temporary`
   flag was built for exactly this ("STORY.md's prologue ally" in its own
   comment): a normal party-kind character — squad-orderable, can be
   downed, wage-exempt (`chargeCrewUpkeep` already skips temporary). Being
   a character (campaign-scoped table) sidesteps the whole seed-cast/
   universe-NPC problem that made cast depth pack-only.
5. **Four stages, engine-advanced:** `intro` → `groundFight` →
   `shipFight` → `graduation` → `complete`. Advancement is engine signals
   only: `intro` advances after the first completed turn; `groundFight` on
   a PERSONAL-scale fight resolved alive; `shipFight` on a SHIP-scale
   fight resolved alive; `graduation` after its one completed turn (the
   departure beat), which also removes the ally.
6. **The storyline + authored sidequests PAUSE while the prologue runs.**
   A new player should meet the sandbox and Season One cleanly, in order.
   ch-1's `tendaysAtLeast: 2` mostly sequences this naturally; the pause
   makes it deterministic.

## ⚠ THE TRAPS for this handoff

1. **Existing campaigns must be UNTOUCHED.** Trap zero of the slice. The
   `undefined`-stage → old-rules mapping (decision 3) is what guarantees
   it; test it hard: a legacy campaign mid-old-tutorial keeps its training
   wheels, a graduated one stays graduated, neither ever sees a prologue
   directive or an ally.
2. **The ally must not RESURRECT on cold load.** `saveCampaignState`
   upserts characters and `loadCampaignState` loads all of a campaign's
   rows — removing the ally from `state.characters` at graduation leaves
   an orphan DB row that would walk back in on the next cold load. Fix at
   the LOAD seam: `lib/state.ts` (or the loader) drops `temporary`
   characters whenever `prologueStage === "complete"` — self-healing, no
   delete query, the row lingers harmlessly. (Same class as the seed-cast
   trap in HANDOFF_STORY_2 — the DB is the source on load, not memory.)
3. **Golden BYTE-IDENTICAL.** The new prologue prompt section returns `[]`
   whenever the stage is unset or complete — true for every golden
   fixture (none sets a stage). If the golden moves, stop.
4. **The scale signal must be captured BEFORE the fight clears.** A
   resolved fight's `session.combat` is nulled by resolution; snapshot
   `session.combat.scale` at the same pre-turn point `wasCombatTurn` is
   computed, and feed `{ combatResolvedAlive, resolvedScale }` to the
   advance function. Personal-scale wins must NOT advance the shipFight
   stage (and vice versa) — that's the whole point of the two stages.
5. **`inTutorial` consumers must ALL follow the redefinition** — the
   redefinition happens INSIDE `shared/tutorial.ts` (`inTutorial` /
   `graduatedTutorialThisTurn` change their implementation, signatures
   unchanged), so death.ts's tutorial-safe death saves, the TUTORIAL
   directives, and the choice clamp follow automatically. Do NOT touch the
   consumers; if you find yourself editing death.ts, stop.
6. **The route pause (decision 6) gates by prologue, passes nothing new
   down.** While `prologueStage` is set and not complete: skip the
   storyline block (don't evaluate/advance/pay; pass `storyline:
   undefined` into `runJsonTurn` so activeChapter/castReveals stay
   silent), and suppress authored-sidequest injection (a
   `suppressSidequests` flag on `resolveJobsTurn`, defaulting false — the
   ONLY shared-code signature change in this slice). The generated board
   keeps working exactly as it does in the tutorial today.
7. **A model that never stages the ship fight stalls the shipFight
   stage.** Accepted risk, same reasoning as the season's eliminate
   finales: the stage directive explicitly instructs it, and the stage is
   hot-recoverable (an admin can set the stage; the directive re-fires
   every turn). No auto-skip this slice — note it in CHECKS.md known gaps.
8. **Migration number: reconcile at build time** (`node
   scripts/next-migration.mjs` + Supabase MCP `list_migrations` on
   `mgsogqnrpvoblqxkfgge`); expected 032 but never hand-picked.

## `pack.prologue` (Task A) — the schema + content

```ts
PackPrologueAlly = { name: string; role: string; oneBreath: string }
PackPrologue = {
  /** One ally per faction id — validatePack: every pack faction has one,
   *  no ally name collides with an existing cast/faction name. */
  allies: Record<string, PackPrologueAlly>;
  /** Stage directives, fed one per turn while that stage is active.
   *  {patron} and {ally} placeholders are filled at render time from
   *  pack.creation.patrons[factionId].name and the ally's name. */
  stages: { intro: string; groundFight: string; shipFight: string; graduation: string };
}
```

The six allies (names LOCKED; `role`/`oneBreath` wording yours):

| faction | name | role gist |
|---|---|---|
| f-crown | Sergeant Vale | Crown escort detail, by-the-book |
| f-sable | Cutter Rhee | Chain minder, keeps the new hand alive |
| f-undertow | Warrant Dask | collections escort, all procedure |
| f-free | Juno Vex | freelance pilot who owes the patron |
| f-wreckers | Korr | raid partner, first-run tradition |
| f-reclaimers | Sova | field tech, salvage-run chaperone |

Stage directive OUTLINES (wording yours, one turn's material each; the
engine re-feeds the stage directive every turn until the stage advances):

- **intro** — {patron} makes the introductions: {ally} is riding along for
  the player's first runs. Establish the ally as PRESENT and at the
  player's side; end pointing at trouble nearby worth handling.
- **groundFight** — steer the scene into a small, forgiving fight
  (`combat.start`, T1, 1-2 foes, personal scale) WITH {ally} in the squad;
  remind the narrator the player can ORDER their ally (squad orders).
- **shipFight** — steer into a weak ship engagement on the player's own
  hull (scale "ship", a lone T1 scout-class): power allocation is the
  lesson. Keep stakes low; fleeing also counts as surviving.
- **graduation** — {ally} ships out (their unit recalled; keep it warm,
  not final) and {patron} hands the player to the open Drift. One clean
  closing beat — the engine removes the ally and prints the graduation
  line this same turn.

## Task breakdown (one commit each)

- **Task A — pack + persistence:** `PackPrologue` schema + validatePack
  rules + the six allies + four stage directives
  (`content/pack/drift/prologue.ts`); `Campaign.prologueStage?` zod field;
  the migration (trap 8), applied + reconciled; `lib/newCampaign` /
  creation route sets `prologueStage: "intro"` on NEW campaigns AND seeds
  the faction ally as a temporary party character (reuse the existing
  crew/temporary-ally construction path from HANDOFF_COMBAT_V2_1 — adapt
  to the real helpers, don't build a parallel one); the load-seam
  temporary-character drop (trap 2). Tests: validatePack completeness
  (every faction an ally, no name collisions); legacy campaigns parse with
  no stage; the load-drop only fires when complete.
  — ✅ SHIPPED 2026-07-18. Migration 032 reconciled against live
  `list_migrations` (031 was the true last-applied, matching the repo).
  `buildCrewMember` (the obvious reuse) turned out NOT to be reusable
  as-is: it derives its id as `crew-<slug>-<rng.int(100,999)>`, and
  `characters.id` is a GLOBAL primary key (not campaign-scoped) — a fixed
  RNG seed risks colliding across campaigns of the same faction. Fixed by
  deriving the ally's id from the already-globally-unique `campaignId`
  directly (`ally-<campaignId>`) and using the tier band's fixed HP
  midpoint instead of an RNG roll, while still sourcing skill/gear/tier
  from the SAME `crewContent` tables `buildCrewMember` itself reads. One
  canonLint catch: a first draft hardcoded a faction→crewRole map in
  `lib/newCampaign.ts` — moved onto the pack itself as
  `PackPrologueAlly.crewRole` (canon mappings live only in `content/pack/`,
  never app code). `buildPrologueAlly` landed in `lib/newCampaign.ts`
  itself (not a new file) — ally construction is a creation-time concern,
  mirroring `buildLoanerShip`'s existing placement in the same file.
- **Task B — the stage machine:** `shared/prologue.ts` — pure
  `advancePrologue(stage, { turnCompleted, combatResolvedAlive,
  resolvedScale })` returning the next stage + display lines (🎓 prefix)
  + `allyDeparts: boolean` on the graduation→complete transition; plus
  `prologueDirective(pack, factionId, stage)` (placeholder filling).
  Tests: the full intro→…→complete walk; personal-scale wins don't
  advance shipFight; ship-scale wins don't advance groundFight; complete
  is terminal.
  — ✅ SHIPPED 2026-07-18. No deviation from spec. One test-authoring note:
  the `shipFight` directive's authored prose doesn't happen to name the
  ally (it reads fine without it), so the placeholder-fill test checks
  every `{ally}`/`{patron}` token resolves rather than asserting every
  stage's rendered line contains the ally's name — a content fact, not a
  logic gap.
- **Task C — wiring:** route captures `resolvedScale` (trap 4), advances
  the stage post-turn (persisted via the campaign row on the existing
  save), removes the ally on `allyDeparts` (in-memory; the load seam
  covers cold loads), prints the lines; the pause gates (trap 6) incl.
  the `suppressSidequests` flag; `shared/tutorial.ts` redefinition
  (decision 3, trap 5); new `llm/promptSections/prologue.ts` + ONE
  registry entry rendering the current stage directive (golden-safe,
  trap 3). Tests: redefinition (staged vs legacy behavior, both
  graduation paths); golden byte-identical.
  — ✅ SHIPPED 2026-07-18. `graduatedTutorialThisTurn`'s existing callers
  (combatTurn.ts/downedTurn.ts/jsonTurn.ts) compare `input.state` against
  `runtime.state` — BEFORE route.ts ever applies the prologue's own stage
  transition — so for a staged campaign that internal call always reads
  false (prologueStage is identical on both sides at that point). That's
  correct, not a gap: a staged campaign's graduation beat comes from
  `advancePrologue`'s own 🎓 line, never the old `TUTORIAL_GRADUATION_BEAT`
  path, so nothing needed editing in those three files (trap 5 held).
  Took the rider from STORY.md/CHECKS.md's known gap ("story-choice facts
  are unpinned... next time the route is open") since this task DOES open
  the route file: the choicePoint fact now carries `pinned: true` (it's
  engine-deterministic, not model output, so it doesn't trip the
  cheap-model-over-pinning risk `pinned` otherwise guards against) — the
  CHECKS.md gap entry is removed rather than left stale.
- **Task D — docs close-out:** STORY.md build order slice 4 SHIPPED (the
  whole doc's roadmap is then complete except future seasons); STATUS.md;
  CLAUDE.md docs map; CHECKS.md rows (legacy-exemption mapping; the
  ally-resurrection load seam; the shipFight-stall known gap); annotate
  THIS handoff per WORKFLOW.md Phase 2.
  — ✅ SHIPPED 2026-07-18.

## Explicitly OUT of scope

Per-faction prologue COMBAT scripting (the fights are model-staged under
tutorial-safe rules, not engine-scripted set-pieces); the ally "returning
in Act 1-2" (Season One's cast is shipped and fixed — the departure stays
warm so a future season can pay it off); prologue entries in the Story
tab; auto-skipping a stalled shipFight stage (trap 7); pinning
story-choice facts (separate known gap, one word, next time the route is
open — do it ONLY if the route file is already being edited in Task C,
as a rider noted in the annotation).

## Definition of done

- ✅ `tsc` clean; full suite green (1102 baseline → **1133 final**, +31
  across the four tasks); golden BYTE-IDENTICAL (confirmed after Task C).
- ✅ Migration 032 applied + reconciled; `inTutorial`/
  `graduatedTutorialThisTurn`'s redefinition is verified to fall back to
  the byte-identical OLD quest-count rule whenever `prologueStage` is
  undefined — every campaign that predates this slice is untouched.
- ✅ The full stage walk (intro → groundFight → shipFight → graduation →
  complete) on the correct signals is proven at the unit level:
  `shared/prologue.test.ts`'s pure walk (Task B) + `lib/newCampaign.test.ts`'s
  ally seeding (Task A) + `db/queries.test.ts`'s load-drop (Task A) +
  route.ts's wiring (Task C) compose the same lifecycle the spec describes
  end to end; no separate route-level integration test was added, matching
  this codebase's existing precedent (storyline/jobs shipped the same way —
  unit tests on the pure modules, never a route-endpoint integration test).
- ✅ The storyline + authored sidequests are provably inert while a
  prologue is active (`inActivePrologue` gates both in route.ts;
  `suppressSidequests` proven against the live pack's own `cold-comfort`
  sidequest, not a stub), and resume untouched at complete (the passthrough
  object carries `session.storyline`/`session.state` through unchanged).
- ✅ One commit per task; this handoff annotated per WORKFLOW.md Phase 2.
