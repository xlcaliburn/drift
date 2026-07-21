# HANDOFF — Playtest polish 2: the stale scene card, the ghost scout, and travel framing

*Strategy phase output (Fable, 2026-07-20). **FULLY SHIPPED 2026-07-20** —
see the per-task annotations below. Read `WORKFLOW.md` first, then this doc
fully. Source: Ludo Duross's live run (`camp-mrr5dyb7-rack`), transcript
ords 46-85 — the owner's report: "where are we going? Halcyon then back to
Halcyon"; "in Quist's office, suddenly back at the copilot seat"; "safely in
Halcyon and then the scout was a threat again".*

## Diagnosis (all verified against the live DB + code)

One player-visible mess, four braided causes:

1. **The scene card FROZE in transit.** Live card at the time of triage:
   `place: "Halcyon high orbit, aboard the courier shuttle"` — unchanged
   through docking (ord 67, "the docking clamps catch, you're home"), a
   dockside standoff, and Quist's office in person (ord 80). The model
   under-fired `scene.place` (the standing structured-field failure mode),
   and `carryScene` copies `place` forward on every scene turnover
   (`shared/scene.ts:179`), so the staleness SELF-REINFORCES: scene 3
   opened at ord 83 — inside Quist's office — still captioned "high orbit,
   aboard the courier shuttle". Every turn's context slice then told the
   model "you are in the cockpit"; the office scenes happened *despite*
   the card, and the first un-anchored player input ("did i finish the
   courier run?") snapped the narration back to the co-pilot seat. That's
   the teleport. No engine backstop touches `place` today — the location
   backstop (`inferLocationFromPlace`) fixes station-level
   `currentLocationId` only, and the whole episode stayed at loc-freeport.
2. **`presentNpcIds` accreted three scenes of people**: both hostile
   pilots (Rustbucket + scout), Quist, the patron, and two dock NPCs all
   "present" at once. The presence-by-speech backstop marked the scout's
   pilot present on the very line where he said "I'm gone" — a departing
   speaker reads exactly like a present one to that heuristic.
3. **The prologue shipFight directive is feeding the ghost.**
   `prologue_stage` is still `shipFight`, so "steer this scene into a WEAK
   ship engagement… a lone T1 scout" re-fires EVERY turn — docked, in an
   office, anywhere. The model keeps conjuring scout threats; the player
   keeps de-escalating with social/piloting checks; **no `combat.start`
   ever fires, so nothing ever resolves, so the stage never advances, so
   the directive fires again.** The directive's own "Fleeing counts as
   surviving it" is honest ONLY for a fight that actually STARTED (a fight
   ending "escaped" does satisfy `combatResolvedAlive`) — a standoff
   resolved by skill checks is invisible to the stage machine. This is
   STORY_4 trap 7 manifesting as a recurring ghost threat, not a stall.
4. **Travel state is never framed.** The engine knew the destination all
   along (active job: deliver plating to The Nest, `loc-nest`), and
   `activeJobs` feeds the objective summary — but nothing states "you are
   AT Halcyon; the delivery is AT The Nest; you have NOT delivered". The
   model offered "Full burn for Halcyon's docking ring" as an escape (back
   to origin, fine) and later answered the player's "did I finish the
   courier run?" by pitching a brand-new crate job instead of the truth.

## Decisions (locked — do not re-litigate)

1. **The scene ANALYST becomes the place backstop.** The analyst is the
   established retro-fixer for everything the live turn under-fires (NPCs,
   threads, facts, fates); place joins that list. `analyzeScene`'s JSON
   contract gains one field: `place` — "where the player PHYSICALLY is at
   the end of this slice — one short line (a room, a deck, a street),
   ≤120 chars; omit if unchanged". `applyAnalystUpdates` writes it to
   `sceneCard.place` (overwrite). Runs on both existing passes — mid-scene
   (`ANALYST_INTERVAL`) and scene close — so a frozen place self-heals
   within ≤10 turns, and a scene close writes the CORRECTED place into the
   card `carryScene` builds. No new model calls, no new schema, no
   migration.
2. **Analyst presence sharpening (same prompt edit):** one clause added to
   the analyst's `presence` instruction — someone who DEPARTED during the
   scene (chased off, flew away, walked out) is `"mentioned"`, never
   `"present"`, even if they spoke on their way out.
3. **The shipFight stage directive is REWRITTEN (pack content —
   hot-applies to Ludo's live campaign immediately, no migration).**
   Required clauses, prose yours (`content/pack/drift/prologue.ts`):
   - fire the engagement only when the player is IN FLIGHT; if docked,
     first get them flying with the shortest believable hook (the active
     delivery they're carrying is the obvious one);
   - the moment the ship threat appears, call `combat.start` (scale
     "ship", a lone weak T1 scout) THAT SAME TURN — explicitly: do NOT
     stage a standoff, a hail exchange, or a chase resolved by skill
     checks first, because only a real fight resolving advances the
     player past training (talking it away just makes the drill repeat);
   - keep "fleeing counts as surviving it" (true once a fight exists);
   - drop the standing threat framing between turns — no lingering
     shadows/watchers when the scene isn't the engagement itself.
4. **`activeJobs` gains explicit travel framing** (`llm/promptSections/
   quests.ts`, using the section's existing `locName` helper). When the
   next objective carries a `locationId`:
   - ≠ `state.campaign.currentLocationId` → append
     ` [destination: ${locName(next.locationId)} — the player is at
     ${locName(currentLocationId)}, NOT there yet; getting there IS the
     step. Never narrate the hand-off before the engine reports arrival]`
   - === current → append ` [the player is AT ${locName} now — play the
     step out here]`
   No other section changes; whereabouts staleness itself is decision 1's
   job.
5. **Ludo's live campaign gets a data repair via the ADMIN EDITOR** (never
   raw SQL — the warm-cache clobber rule): a `sceneCard` op setting
   `place: "Halcyon — dockside, near Harbormaster Quist's office"` and
   `presentNpcIds: ["npc-quist", "npc-patron-camp-mrr5dyb7-rack"]`, plus
   (optional, owner's call) a GM note: "Ludo is docked at Halcyon; the
   courier delivery to The Nest is still in the hold, undelivered; the
   scout was chased off by the station guns and is GONE." This is the
   owner's click, not code — listed here so it isn't lost.
6. **NOT fixed this slice** (noted in CHECKS.md known gaps): the
   presence-by-speech backstop marking a DEPARTING speaker present — the
   heuristic can't tell "I'm gone" from a greeting. Cause #2's accretion
   is mitigated by decisions 1-2 (the analyst now corrects both place and
   departed-NPC presence every ≤10 turns); a live-turn departure detector
   is its own future slice if playtests still surface it.

## ⚠ Traps

1. **The analyst place write must not clobber a LEGITIMATE move.** The
   analyst runs in the background (`after()`); by the time its result
   applies, the live session may have genuinely moved on. Gate the write
   on scene identity: the mid-scene pass applies `place` only if the live
   card's `seq` still equals the analyzed scene's seq; the close pass
   applies only if the live card's seq is analyzed-seq + 1 (the card
   `carryScene` just built — the exact stale-carry being corrected).
   Seq mismatch → drop the place update silently. Follow how
   `applyAnalystUpdates` already guards its other writes; extend, don't
   invent a parallel guard.
2. **`place` from the analyst is untrusted model output**: trim, cap at
   120 chars (the TurnPlan cap), ignore empty/whitespace. It must never
   contain a location ID — it's free prose, same as the model's own
   `scene.place`.
3. **Golden**: decision 4 edits a prompt section. If the golden fixtures
   include an active job with a `locationId` objective, the golden moves —
   inspect that ONLY the new bracket clause appeared on activeJobs lines,
   re-pin exactly once, and say so in the commit. If the golden does NOT
   move, the fixtures never exercised the branch — add a unit test on the
   section instead (`quests.test.ts` exists).
4. **The prologue directive rewrite is CONTENT, not schema** — no test
   should pin directive prose. `pack.test.ts` checks stages non-empty;
   `prologue.test.ts` checks placeholders resolve. Both survive any
   wording. If you find yourself editing a schema or a test assertion
   for Task B, stop.
5. **Do not touch the stage machine, again.** advancePrologue's signals
   are correct — a started ship fight that ends escaped/won already
   advances. The fix is making the model START the fight (directive) —
   not widening the engine's definition of "resolved".
6. **The analyst prompt is length-sensitive** (deepseek-v4-flash, JSON
   truncation was the fleet's biggest memory-loss source). The two prompt
   additions (place field + departed clause) must be ONE line each, no
   examples beyond a parenthetical.

## Task breakdown (one commit each)

- **Task A — analyst place sync + presence clause:** decisions 1-2 —
  `llm/summarizer.ts` (ANALYST_SYSTEM + the parsed `SceneAnalysis` type),
  `lib/analystRun.ts` (`applyAnalystUpdates` place write behind the seq
  guard, trap 1). Tests: place applied on seq match; dropped on mismatch;
  close-pass writes into the carried card (seq+1); cap/empty handling
  (trap 2). The analyst call itself stays untested (LLM precedent) — test
  the APPLY path with a stubbed analysis object.
  — ✅ SHIPPED 2026-07-20. As specced. `applyAnalystUpdates` gained one
  optional trailing param (`placeUpdate?: {place, expectedSeq}`) rather
  than a parallel function — the seq check folds into the SAME early-return
  guard the npc/item/thread/fact updates already share. `runOpenSceneAnalyst`
  captures `analyzedSeq` synchronously BEFORE the await (the live session is
  a shared in-memory object across concurrent requests, so this genuinely
  matters, not just defensive style). 5 tests, all on the stubbed apply path.
- **Task B — shipFight directive rewrite:** decision 3, prose within the
  locked clauses (`content/pack/drift/prologue.ts` only; trap 4).
  — ✅ SHIPPED 2026-07-20. All four clauses in one paragraph; no schema or
  test change (trap 4 held) — `pack.test.ts`/`prologue.test.ts` stayed
  content-agnostic as designed.
- **Task C — activeJobs travel framing:** decision 4 + trap 3's
  golden/test discipline.
  — ✅ SHIPPED 2026-07-20. Golden confirmed UNCHANGED (no fixture carries an
  active job with a `locationId` objective) — per trap 3's fallback,
  3 direct unit tests added to `quests.test.ts` instead of a golden re-pin.
- **Task D — docs + the live repair note:** CHECKS.md (a §1 row for the
  analyst place sync; the presence-by-speech departing-speaker known gap;
  update the shipFight-stall known-gap entry to record how it actually
  manifested); STATUS.md; annotate THIS handoff per WORKFLOW.md Phase 2.
  Decision 5's admin-editor repair is the OWNER's click — list it in the
  close-out summary so it happens.
  — ✅ SHIPPED 2026-07-20 (docs). Decision 5's repair is flagged to the
  owner in the close-out message, NOT performed by the implementer — this
  session has no admin-UI credentials (Google auth) and raw SQL is
  explicitly against the handoff's own decision 5. Exact op left for the
  owner's click: `sceneCard` → `place: "Halcyon — dockside, near
  Harbormaster Quist's office"`, `presentNpcIds: ["npc-quist",
  "npc-patron-camp-mrr5dyb7-rack"]`, campaign `camp-mrr5dyb7-rack`.

## Explicitly OUT of scope

A live-turn departure detector (decision 6); any advancePrologue change
(trap 5); a persistent "traveling from X to Y" state on the campaign row
(the job objective + decision 4's framing carry it); auto-starting the
prologue ship fight from the engine side (trap 7's no-auto-skip stance
stands — the directive now makes the model do it).

## Definition of done

- ✅ `tsc` clean; full suite green (1144 baseline → **1152 final**, +8);
  golden confirmed BYTE-IDENTICAL throughout (never re-pinned — Tasks A/C
  both ran against golden and it didn't move).
- ✅ A stubbed analysis carrying `place` corrects a stale card on seq match
  and never on mismatch, in tests (`lib/analystRun.test.ts`).
- ✅ The live pack's `shipFight` directive contains all four locked clauses.
- ✅ An active delivery job's context line names BOTH ends and states the
  player hasn't arrived, in a unit test (`quests.test.ts`).
- ✅ One commit per task; this handoff annotated per WORKFLOW.md Phase 2.
- ⏳ Decision 5's live repair on `camp-mrr5dyb7-rack` is the OWNER's click
  through the admin campaign editor (`/admin/campaigns`), not part of this
  code ship — the exact op is in Task D's annotation above.
