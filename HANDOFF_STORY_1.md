# HANDOFF — Story slice 1: the `report` objective + the storyline machinery

*Strategy phase output (Fable, 2026-07-18). **FULLY SHIPPED 2026-07-18** — all
four tasks annotated below. Design source: `STORY.md` (decisions RESOLVED +
four owner calls made 2026-07-18, baked in below). This slice is MACHINERY
proven with a test-only stub — the season-one script (content) and the
prologue are the next two slices and are NOT built here.*

## Owner decisions this slice implements (locked)

1. **Machinery first, stub story** — the engine + a 2-chapter stub that lives
   ONLY in test fixtures. The live pack ships an EMPTY storyline (dormant).
2. **Fable drafts content later, owner edits** — so this slice also delivers
   `STORY_AUTHORING.md` (the format guide) and an authoring-friendly format:
   ids are forever, everything else hot-editable (see trap 5).
3. **Retrofit live campaigns** — triggers are STATE PREDICATES re-evaluated
   every turn, never event-edges. An existing campaign already past a
   threshold qualifies the moment the content ships. No backfill.
4. **Patient pacing** — an OPEN chapter never hijacks a turn. It surfaces as
   an `activeChapter` prompt directive + a Story-tab entry, with ONE nudge
   beat if ignored for a while (the backstoryPressure cadence). The sandbox
   stays primary.

## ⚠ THE TRAPS for this handoff

1. **jsonb, both ways.** The new `campaign_runtime.storyline` column loads
   UNPARSED — `lib/state.ts` normalizes a missing/legacy value to a fresh
   empty state. AND the twice-learned frozen-jsonb lesson (CHECKS.md §0):
   the slice stores ONLY progress pointers (chapter ids, beat ids, choice
   option ids, counters) — never copies of pack content. Content is read
   live from the pack every turn, which is exactly what makes the story
   hot-editable.
2. **Golden BYTE-IDENTICAL.** The new `activeChapter` section returns `[]`
   whenever there's no active chapter. The live pack has zero chapters this
   slice, so the golden fixture renders nothing new. If the golden moves,
   stop — you've made the section render for empty state.
3. **The stub is TEST-ONLY.** Two stub chapters live in test fixtures
   (`shared/storyline.test.ts` etc.), NOT in `content/pack/drift/`. Shipping
   them live would arm a half-story for every retrofitted campaign.
4. **Beat delivery must join the turn-failure rollback.** The route's
   `memorySnapshot` restores sceneCard/npcRelations/npcs when a turn fails —
   the storyline slice must be snapshotted/restored the same way, or a
   failed turn burns a beat (delivered-but-never-narrated, the beat version
   of the double-payout class).
5. **Ids are forever; everything else degrades gracefully.** The advance
   engine must tolerate content edits under live progress: an active chapter
   id no longer in the pack → the chapter is dropped with a log line, next
   trigger evaluates fresh; a delivered-beats list referencing removed beat
   ids → ignored; objectives are re-read from the pack each turn with `done`
   flags matched BY OBJECTIVE ID (an author inserting an objective mid-list
   must not shift completion). Write these as tests.
6. **Migration 031** (`storyline jsonb`) — reconcile with
   `node scripts/next-migration.mjs` + Supabase MCP `list_migrations` (the
   house rule; parallel windows have collided before). Apply via
   `apply_migration` on project `mgsogqnrpvoblqxkfgge`.
7. **The engine owns progression** (the invariant). The model NEVER advances
   a chapter, completes an objective, or invents a beat — detection is real
   signals only (arrival, fights, skill successes, NPC presence, clicked
   choice chips). The narrator dramatizes what the section TELLS it is
   active.

---

## Task A — the `report` objective kind (QUESTS 1b) — ✅ SHIPPED 2026-07-18

The one missing objective primitive everything authored needs: "talk to X".

1. `shared/quests.ts`: `ObjectiveKind` gains `"report"`. `Objective` gains
   `npcId?: string` (the target). `TurnSignals` gains
   `presentNpcIds: Set<string>`; `turnSignals(...)` gains a parameter for it
   (the route passes `session.sceneCard.presentNpcIds` — the same
   presence truth the People panel uses). `objectiveMet`: `report` is met
   when `obj.npcId` is in `s.presentNpcIds` — SHARING A SCENE with the
   target is the engine-verifiable signal (same class as travel=arrival).
   Conservative by design: no name-matching on typed text this slice.
2. Thread the new signal through the ONE `turnSignals` call site in the
   route. Existing generated jobs never produce `report` objectives (the
   generator is untouched) — this kind exists for authored content.
3. `QUESTS.md`: mark 1b's `report` item done.

**Tests:** report met on presence / not met when absent; a job mixing
travel→report→persuade advances in order; turnSignals carries presence.

**Shipped as specced.** `objectiveMet` was left private in this task and
exported in Task C once `shared/storyline.ts` needed to reuse it — the exact
same completion rule, never a second implementation.

## Task B — the pack storyline schema (types only, live pack stays empty) — ✅ SHIPPED 2026-07-18

`content/pack/types.ts` (+ export via `content/pack/drift/storyline.ts`,
a typed `.ts` module like ship2/creation — same reasoning):

```ts
PackStoryTrigger = {
  // ALL specified conditions must hold (AND). All are state predicates.
  requiresChapterId?: string;      // prior chapter complete (null = an opener)
  tendaysAtLeast?: number;
  atLocationId?: string;           // currently AT this location
  factionRepAtLeast?: { factionId: string; rep: number };
  npcTrustAtLeast?: { npcId: string; disposition: number };
  hasFact?: string;                // substring match against the facts ledger
}
PackStoryBeat = {
  id: string;
  directive: string;               // fed verbatim to the narrator, one at a time
  fallbackDirective?: string;      // used when `aboutNpcId` is dead/gone (STORY.md rule)
  aboutNpcId?: string;             // the mortal-NPC guard checks this
}
PackChoiceOption = { id: string; label: string; fact: string } // fact recorded on pick
PackStoryChapter = {
  id: string; act: 1|2|3; title: string;
  trigger: PackStoryTrigger;
  castNpcIds: string[];            // pack cast ids — "use EXACTLY these people"
  objectives: {                    // authored, ordered; Objective minus `done`
    id: string; kind: ObjectiveKind; summary: string;
    locationId?: string; npcId?: string; enemyTier?: "T1"|"T2"|"T3";
    requiredSkills?: string[];
  }[];
  beats: PackStoryBeat[];
  choicePoint?: { id: string; prompt: string; options: PackChoiceOption[] }; // 2-3 options
  reward: { credits: number; factionRep?: { factionId: string; delta: number } };
}
PackStoryline = { chapters: PackStoryChapter[] }  // ordered; ids unique
```

`PackNpc` gains optional authored depth (schema only this slice — content
fills them later): `backstory?`, `secret?`, `arc?`. (`voice` already exists
as a runtime column; pack-authored voice rides the content slice.)

`validatePack`: chapter ids unique; every `castNpcIds`/trigger/objective
npc/location/faction id resolves; every `requiresChapterId` references an
EARLIER chapter (no cycles); every beat with `aboutNpcId` referencing a
cast member has a `fallbackDirective`; exactly ≤1 choicePoint per chapter.
`content/pack/drift/storyline.ts` ships `{ chapters: [] }`. `pack.test.ts`
gains the completeness checks (running against the empty live pack AND the
schema-level rules via a fixture).

**Shipped as specced**, plus one addition: `pack.test.ts` also PINS
`PackStoryObjective`'s duplicated `kind` enum against `shared/quests.ts`'s
real `ObjectiveKind` (comparing the sorted literal sets) — the doc comment on
the schema promised this check; it's now a real test, not just a promise.

## Task C — the storyline engine + runtime slice + context — ✅ SHIPPED 2026-07-18

1. **`shared/storyline.ts`** (pure, model-free, the heart):
   - `StorylineState = { chapters: Record<chapterId, { status: "active"|"complete"; objectivesDone: string[]; deliveredBeatIds: string[]; choiceOptionId?: string; openedAtTenday: number; lastNudgeTenday?: number }> }`
     — pointers only (trap 1). `freshStorylineState()`.
   - `evaluateTriggers(pack, state, campaignView)` → chapter ids to OPEN
     (predicates over tendays/location/rep/trust/facts; requires-chain
     enforced; at most ONE chapter opens per turn — patient pacing).
   - `advanceStoryline(pack, state, signals)` → objective completion via the
     SAME `objectiveMet`/`TurnSignals` the jobs use (report included),
     matched by objective id (trap 5); chapter completes when all objectives
     done AND choicePoint (if any) chosen; returns display lines (📖 prefix)
     + completions for the route to pay (credits + rep through the existing
     payout/rep paths).
   - `nextBeat(pack, state, npcs)` → the ONE beat to feed this turn: first
     undelivered beat of the active chapter, honoring the mortal-NPC rule
     (aboutNpcId dead/gone → fallbackDirective, still marked delivered);
     nudge logic: if no undelivered beats remain and the chapter has sat
     un-advanced ≥ 3 tendays since `lastNudgeTenday`, re-surface a short
     reminder directive derived from the current objective summary.
   - `recordChoice(pack, state, chapterId, optionId)` → sets choiceOptionId
     + returns the fact string to append to the ledger.
   - Graceful-degradation behaviors from trap 5, all unit-tested against the
     2-chapter TEST stub.
2. **Persistence:** migration `031_runtime_storyline.sql`
   (`storyline jsonb not null default '{}'::jsonb` on `campaign_runtime`);
   `SessionData.storyline` + load normalization in `lib/state.ts`
   (`runtime.storyline ?? freshStorylineState()` — cover the legacy-null
   shape); save in `persistSession`/`saveCampaignRuntime` beside jobs; add
   the slice to the route's `memorySnapshot` rollback (trap 4).
3. **Route wiring** (where `resolveJobsTurn` runs today): evaluate triggers →
   advance → pay completions → mark the delivered beat AFTER the turn
   succeeds. Choice points surface as engine chips on the choices bar when
   the active chapter's objectives are done (`storyChoice` route param +
   `ChoiceOption` field `{ storyChoice: { chapterId, optionId } }` — zod,
   optionalNullable object; clicking records the fact + completes the
   chapter). Chip kind entry (📖).
4. **Context:** `llm/promptSections/activeChapter.ts` + ONE registry entry —
   renders the active chapter title, the current objective summary, the cast
   line ("use EXACTLY these people"), and THIS turn's beat directive (from
   `nextBeat`). Returns `[]` when no active chapter (trap 2). `/api/state`
   exposes the storyline slice + the pack's act/chapter titles for the tab.
5. **Tests:** trigger predicates (incl. retrofit: a campaign already past
   tenday/rep thresholds opens on first evaluation); requires-chain; advance
   by id with an inserted objective (trap 5); beat order + fallback on a
   dead NPC + nudge cadence; choice recording → fact; rollback-safety shape
   (delivered marking only on success — testable at the storyline.ts level
   by making marking an explicit call); golden byte-identical.

**Shipped as specced**, with the design gaps resolved as follows:
- **`shared/storylineRuntime.ts`** is a NEW file (not named in the spec) —
  the thin payout bridge mirroring `shared/jobsRuntime.ts` 1:1 (pays
  credits/rep, calls `markBeatDelivered`). Kept separate from
  `shared/storyline.ts` for the same reason quests/jobsRuntime are separate:
  the engine stays model-free and DB/state-free; the bridge is where
  side-effects (reward application) live.
- **An extra orphan-drop pass** was added inside `evaluateTriggers` (not just
  `advanceStoryline`) — a chapter dropped from the pack while ACTIVE is
  pruned with a log line the moment triggers are next evaluated, freeing the
  slate for whatever opens next; a COMPLETE chapter's record survives even if
  later removed from the pack, since a future `requiresChapterId` may still
  need to resolve it.
- **`activeChapter.ts` imports `pack` directly** (not threaded as a param)
  from `@/content/pack` — the same convention `economy.ts`/`npcTiers.ts` use
  for pack-authored content; only the RUNTIME pointers (`StorylineState`)
  ride `SectionCtx`.
- **Rollback**: `resolveStorylineTurn` is only ever called with LOCAL
  variables (never mutating `session.storyline` in place), so it's
  rollback-safe by construction — the same pattern `jobsRuntime`/`jobsBoard`
  already uses. `session.storyline` was ALSO added to the route's
  `memorySnapshot`/catch-restore anyway, matching the trap's literal ask and
  giving defense in depth against a future refactor that breaks the
  local-variable discipline.
- **`storyChoice`**: a `ChoiceOption` field `{ chapterId, optionId }` (zod
  object, not two separate string fields) — forwarded generically through
  `PlayClient.tsx`'s existing `{ ...action }` chip-click spread, no new
  client wiring needed to SEND it. The chip itself is generated in
  `route.ts` once every objective is done and no pick has landed, one chip
  per option, each carrying its own `optionId`.
- Migration 031 applied to project `mgsogqnrpvoblqxkfgge` and reconciled
  (030 was the prior head, matching the repo); live check confirmed all 18
  `campaign_runtime` rows carry `storyline = '{}'` — fully dormant.

**Phase-3 review (Fable, 2026-07-18) — two real defects found and fixed
forward (both in this task's wiring, both would have been invisible until
content shipped):**
1. **Combat rounds burned beats.** `preTurnBeat` was computed and passed as
   `deliveredBeat` on EVERY turn — but the `activeChapter` section only
   exists on the JSON path (`combatTurn.ts` builds no context slice), so
   each round of a fight with an active chapter marked one beat
   delivered-but-never-narrated: trap 4's exact class, arriving through a
   path gap instead of the rollback gap the trap described. Up to N beats
   gone per N-round fight. Fixed: `preTurnBeat` is now
   `wasCombatTurn ? null : nextBeat(...)`; objective ADVANCE still runs on
   combat turns (eliminate/survive need the fight's outcome) — only beat
   delivery is JSON-path-gated. CHECKS.md §0's row updated.
2. **A story choice wasn't actually final.** The chip tooltip promises
   "can't be undone", but `recordChoice` implemented last-pick-wins and
   `revalidateChoices` passed a persisted `storyChoice` chip through blind —
   a stale chip after a two-tab race (picked in tab B, refreshed tab A)
   could re-decide the chapter and append the road-not-taken's fact BESIDE
   the real one, leaving both `sided-crown` and `sided-chain` on the ledger
   with later `hasFact` triggers firing on the rejected branch. Fixed at
   both ends: `recordChoice` is first-pick-wins (a recorded choice makes any
   later pick a no-op, no fact), and `revalidateChoices` drops a
   `storyChoice` chip unless its chapter is still active AND unpicked (the
   slice threaded from `/api/state`; callers without it fail open since the
   engine side alone suffices). New CHECKS.md §0 row.

Tests: +2 (first-pick-wins in `storyline.test.ts`; the four staleness cases
in `choices.test.ts`) → 1051 total. The review found no issues in Tasks
A/B/D; the pure engine, schema, and UI shipped clean.

## Task D — Story tab + the authoring guide + close-out — ✅ SHIPPED 2026-07-18

1. `components/sidebar/StoryTab.tsx`: a "Season" block above the character
   traits — act/chapter title, objective checklist (done/pending), the
   choice made (if any). Hidden entirely when the pack has no chapters
   (this slice: always hidden live — that's correct).
2. **`STORY_AUTHORING.md`** (the owner-facing guide): the chapter format
   field-by-field, the ids-are-forever rule, what's hot-editable
   mid-campaign (everything but ids), how triggers compose, the mortal-NPC
   fallback rule, how to run the stub locally to try a chapter. Short,
   practical, with one full annotated example chapter.
3. Docs: STORY.md build-order item 1+2 marked SHIPPED (machinery; content
   next); QUESTS.md 1b `report` done; STATUS.md; CLAUDE.md docs map;
   CHECKS.md rows (storyline load normalization §0; beat-delivery rollback
   §0; report-objective presence detection under the quests family);
   annotate THIS handoff per WORKFLOW.md Phase 2.

**Shipped as specced.** The Story tab's "Season" block lives in
`components/sidebar/StoryTab.tsx` as `StorySeason` (a new export alongside
the existing `StoryDetail`/`StoryThreads`/`FactsMemory`), rendered in
`DetailsModal.tsx` above `StoryDetail`, threaded from `PlayClient.tsx` the
same way `jobs`/`facts` already ride `/api/state` + the turn "done" payload
+ the SSE event stream. It cross-references `pack.storyline.chapters`
client-side (bundled, same pattern `MapTab`/`RemakeEditor` already use for
pack data) against the server-owned `StorylineState` pointers — never
decides progression itself. Hidden entirely (`return null`) whenever no
chapter has any progress record yet, which is every campaign this slice. A
📖 chip-kind entry was added to `components/chipKinds.ts` for the
`storyChoice` chip. Manual verification: `npx tsc --noEmit` + the full
`npx vitest run` suite (105 files / 1049 tests) both clean; the dev server
boots and the home page loads with zero console/server errors. A full
signed-in browser walkthrough of the Story tab wasn't possible in this
environment (Google OAuth is configured, no test credentials available) —
acceptable given the feature is inert everywhere until content ships (there
is nothing for `StorySeason` to render yet on any real campaign).

## Explicitly OUT of scope

The season-one script itself (next slice — Fable drafts, owner edits);
`pack.sidequests` (rides the content slice — same Job machinery, nothing new
to build); the prologue/Chapter 0 + `inTutorial` change (slice after
content); unique-item rewards (credits+rep only for now); typed-text choice
inference (chips only); seasons/end-dates; NPC-initiated contact.

## Definition of done

- `tsc` clean; full suite green (1015 baseline + new); golden BYTE-IDENTICAL.
- Migration 031 applied + reconciled; live check: `storyline` column exists,
  a live campaign loads (normalization), and NO chapter is active anywhere
  (the live pack is empty — dormancy is the shipping state).
- The 2-chapter stub drives the full loop in tests: trigger → beats →
  objectives (incl. one `report`) → choice → reward → next chapter.
- One commit per task; annotate this handoff per WORKFLOW.md Phase 2.
