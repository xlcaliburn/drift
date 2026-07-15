# REFACTOR.md — promptBuilder sections + jsonTurn plan handlers

> **STATUS: Plan 1 SHIPPED** (golden test `contextSlice.golden.test.ts`;
> `jsonSystem.ts` + `retrieval.ts` extracted, dead `DM_STYLE`/`buildSystem`
> deleted; `promptSections/` registry — grouped 4-way framing/pcSheet/economy/
> world rather than the 19 micro-files below, same additive benefit). Snapshots
> byte-identical throughout. **Plan 2 (jsonTurn) is NEXT and not yet started.**

Goal: multiple Claude windows editing in parallel with limited overlap. The two
hottest files (`llm/promptBuilder.ts` — 53 edits/6wk, `llm/jsonTurn.ts` — 45)
are hot because **every feature is a horizontal slice through them**: a new
mechanic edits promptBuilder (a context line) and jsonTurn (an apply block)
every single time. The fix is to make both **additive**: new feature = new file
+ one registry entry, not an edit inside a 600/1100-line function.

Companion work already landed: Sidebar split (`components/sidebar/`), PlayClient
chip registry (`components/chipKinds.ts`), narrator.ts deletion.

**Hard rule for both plans: zero behavior change.** Every phase is pure code
motion behind an unchanged public API, landed as its own commit with the full
suite green. One window does this work; no parallel writers while it lands.

---

## Plan 1 — `promptBuilder.ts` → `llm/promptSections/`

### What's in the file today (~604 lines)

| Region | Lines | Contents |
|---|---|---|
| `DM_STYLE` + `buildSystem` | 16–44, 125–139 | **DEAD** — freeform-loop system prompt; no importers (combat/downed/appeal own their prompts) |
| `JSON_DM_STYLE` + refs | 46–111 | The JSON contract: voice + rules 1–12 + examples. Edited constantly (every prompt-rule tweak) |
| `buildJsonSystem` | 113–123 | Wraps JSON_DM_STYLE + universe primer into cached blocks |
| retrieval | 141–319 | `tokenize`, `npcIsGone`, `proximityTag`, `reachableDossiers`, `otherCharactersBlock`, `retrieveEntities` |
| `buildContextSlice` | 326–603 | ONE function computing ~20 context "lines/blocks" and joining them in a fixed order |

Consumers (checked): `jsonTurn.ts` (buildJsonSystem, buildContextSlice,
retrieveEntities), `directive.test.ts` (buildContextSlice), `retrieval.test.ts`
(retrieveEntities). Nothing else.

### The 20 sections inside `buildContextSlice`, in emit order

1. tutorial directive (jsonMode-dependent)
2. PREVIOUSLY block (recent-scene tail + keyword-recalled older scenes)
3. player directive line ("PLAYER'S OWN AIM")
4. `CURRENT SCENE` header + location line
5. SEASON line (Fault Line clock phases)
6. SCENE NOW (card: place/situation/dangers/beats)
7. PC skills line
8. identity line (background/ambition/appearance)
9. gear line, 10. consumables line, 11. moral line
12. Party & PC vitals (+ per-char lines)
13. Ship line (ownership + exact armament)
14. THREAT BAND line (net-worth ceiling)
15. MARKET HERE line, 16. DOCK REPAIR + DOCK DEBT lines
17. YOUR PATRON line (STARTER.md), 18. BODY-MOD line (Rook only)
19. NPCs-in-play block (quirk/hook/standing/relationHistory) + OTHER PLAYERS' CHARACTERS block
20. Relevant threads + Clocks + Faction rep + ids line

### Target shape

```
llm/
  jsonSystem.ts            JSON_DM_STYLE + buildJsonSystem  (rule edits stop colliding with section edits)
  retrieval.ts             retrieveEntities + tokenize + npcIsGone (+ its constants)
  promptBuilder.ts         ~30-line FACADE: re-exports buildJsonSystem, buildContextSlice,
                           retrieveEntities so NO consumer import changes
  promptSections/
    types.ts               SectionCtx + Section
    index.ts               the ORDERED registry + buildContextSlice implementation
    tutorial.ts  previously.ts  directive.ts  sceneHeader.ts  season.ts  sceneNow.ts
    pcSheet.ts   vitals.ts  ship.ts  threat.ts  market.ts  dock.ts  patron.ts  bodyMod.ts
    npcs.ts      cameos.ts  threads.ts  worldStatus.ts
```

Section contract — everything derived ONCE in a shared ctx, each section pure:

```ts
export interface SectionCtx {
  state: CampaignState;
  playerText: string;
  jsonMode: boolean;
  retrieved: { npcs: CampaignState["npcs"]; threads: CampaignState["threads"] };
  memory?: { sceneCard?: SceneCard; npcRelations?: NpcRelations; recentScenes?: SceneMemory[] };
  otherDossiers?: Dossier[];
  // derived once in buildSectionCtx:
  pc?: Character;
  loc?: CampaignState["locations"][number];
  presentSet: Set<string>;   // sceneCard.presentNpcIds
  rels: NpcRelations;
}
// A section returns the LINES it contributes ([] = omitted). Returning lines
// (not one string) lets the registry reproduce today's exact blank-line layout.
export type Section = (ctx: SectionCtx) => string[];
```

```ts
// promptSections/index.ts — order IS the prompt layout; a literal "" is a spacer
const SECTIONS: (Section | "")[] = [
  tutorial, previously, directive,
  sceneHeader, season, sceneNow, "",
  pcSheet, vitals, ship, threat, market, dock, patron, bodyMod, "",
  npcs, cameos, threads, "",
  worldStatus,
];

export function buildContextSlice(/* EXACT same signature as today */): string {
  const ctx = buildSectionCtx(...);
  return SECTIONS.flatMap((s) => (s === "" ? [""] : s(ctx))).join("\n");
}
```

Notes on tricky sections:
- `previously.ts` needs `tokenize` (import from `retrieval.ts`) and
  `RECENT_SCENES_IN_PROMPT`; it also reads `retrieved`-adjacent surfaced ids —
  today it derives `surfacedIds` from `npcs + focusIds`, so `focusIds` joins ctx.
- `npcs.ts` owns `proximityTag` (its only user) and imports `relationSuffix`/
  `relationHistory`/`generateQuirk`.
- `cameos.ts` owns `reachableDossiers` (re-export via facade — it's exported today)
  and `otherCharactersBlock`.
- `worldStatus.ts` keeps the jsonMode fork for the ids line.
- The conditional-inclusion idiom (`...(line ? [line] : [])`) becomes each
  section returning `[]` — same output.

### Steps (each its own commit)

1. **Golden test FIRST** — `llm/contextSlice.golden.test.ts`: snapshot
   `buildContextSlice` output for the `vessCampaign` fixture across ~8 configs
   (tutorial on/off, jsonMode both, ship/no-ship, market/no-market, patron
   eligible/outgrown, with memory + dossiers, downed PC). Inline-snapshot the
   strings. This pins "byte-identical" before anything moves.
2. Extract `llm/jsonSystem.ts` (JSON_DM_STYLE + buildJsonSystem) and
   `llm/retrieval.ts` (retrieveEntities + tokenize + npcIsGone + STOPWORDS +
   MAX_NPCS/MAX_THREADS); promptBuilder re-exports both. Delete the dead
   `DM_STYLE` + `buildSystem` in the same commit. Also delete the unused
   `party` local (line 342).
3. Create `promptSections/` and move sections in three batches (world-status +
   pc-sheet first, then economy cluster, then previously/npcs/cameos last —
   they're the fiddliest). After each batch the golden test must pass unchanged.
4. Final: promptBuilder.ts is the facade; update CLAUDE.md "where things live".

### Acceptance
- Golden snapshots unchanged through every step.
- `directive.test.ts`, `retrieval.test.ts` untouched and green (facade keeps
  their imports working).
- tsc clean, full suite green.

### Payoff
A new context line (like patron was) = one new `promptSections/x.ts` + one
registry entry. A prompt-RULE tweak edits `jsonSystem.ts` only. The 53-edit/6wk
hotspot becomes ~5 small files that rarely intersect.

---

## Plan 2 — `jsonTurn.ts` → `llm/applyPlan/` (+ preActions)

### What's in `runJsonTurn` today (lines 357–1117 of ~1118)

| Region | Lines | Contents |
|---|---|---|
| A. setup | 357–390 | model resolve, usage/telemetry, TurnRuntime, `emit` plumbing |
| B. `openFightFromSkill` | 397–422 | gun-skill → combat reroute (used by C **and** G) |
| C. pre-handlers | 426–516 | impliedCheck inference; preCheck roll/combat; preUseItem; preRepair; preRest; preSwap |
| D. prompt assembly | 518–552 | buildJsonSystem + retrieval + context + messages + promptDump |
| E. call machinery | 554–632 | `call` / `callWithFallback` / `plannedCall` (DeepSeek stream + Anthropic + parse-retry-repair) |
| F. plan hygiene | 634–685 | anti-echo retry; `resolveChoiceChecks`; enforce-one-check retry |
| G. mid-turn roll | 687–744 | `plan.roll` → combat reroute + re-narrate, or roll_check + outcome re-call |
| H. danger | 746–765 | unavoidable hazard save |
| I. **apply intents** | 767–946 | payout, offers, useItem, purchase, sell, repair, patronRest, bodyMod, npcs, items, scene, worldEvent, threads, clocks, sceneEnd + auto-close |
| J. combatStart | 948–1012 | spawn-spec building: tier clamp, ≤5 total, narrated-count backstop, ship scale |
| K. cleanup/backstops | 1014–1077 | syncDockDebt; redactMoney; dialogue-NPC registration; presence marking; refreshSituation |
| L. return | 1078–1117 | choices clamp, exchangeDump, result + telemetry |

**Where features actually land** (the collision surface): regions **C, I, J** —
purchase/sell/repair/patronRest/bodyMod/threads each added a block there.
Regions E/F/G are genuinely sequential model-call plumbing entangled with
`messages[]` — they are NOT the hotspot and stay in the orchestrator.

### Target shape

```
llm/
  jsonTurn.ts              orchestrator (~500 lines): A, D, E, F, G, H, L
                           + the anti-echo/enforce-check machinery it owns
  openFight.ts             openFightFromSkill + dcToTier + TIER_TO_CLASS + COMBAT_SKILLS
  preActions.ts            region C: runPreActions(input, ctx) — the clicked-chip
                           pre-handlers (check/useItem/repair/rest/swap)
  engineLines.ts           rollDisplayLines + engineContextLine + outcomeDirective
                           (+ redactMoney if we also move it — see Facade note)
  narrationBackstops.ts    region K minus syncDockDebt: dialogue-NPC registration,
                           presence marking, first-relation seed, refreshSituation
  applyPlan/
    types.ts               ApplyCtx + PlanHandler
    index.ts               ORDERED handler registry + applyPlan()
    money.ts               payout + offers (negotiationMood + payoutCeiling clamps)
    items.ts               useItem + purchase + sell + items[] gear grants
    repair.ts  patronRest.ts  bodyMod.ts
    npcs.ts                plan.npcs registration/presence/relations (+ name gates)
    continuity.ts          plan.scene + worldEvent
    quests.ts              threads open/resolve (+ dedup)
    clocks.ts              clockAdvances
    sceneEnd.ts            sceneEnd + SCENE_TURN_CAP auto-close
    combatStart.ts         region J (spawn specs, clamps, count backstop, ship scale)
```

Handler contract:

```ts
export interface ApplyCtx {
  runtime: TurnRuntime;
  pc: Character | undefined;
  input: JsonTurnInput;                 // playerText, state (pre-turn), preCheck…
  emit: (lines: string[]) => void;
  toolCalls: string[];                  // push telemetry markers as today
  lastRoll: { skill: string; outcome?: string } | null;  // set by pre/mid rolls
  combat: CombatState | null;           // combatStart.ts assigns; others read
}
export type PlanHandler = (plan: TurnPlan, ctx: ApplyCtx) => void;

// applyPlan/index.ts
const HANDLERS: PlanHandler[] = [
  money, items, repair, patronRest, bodyMod,
  npcs, gearItems, continuity, quests, clocks, sceneEnd,
  combatStart,          // LAST — skipped when ctx.combat already set by a reroute
];
export function applyPlan(plan: TurnPlan, ctx: ApplyCtx): void {
  for (const h of HANDLERS) h(plan, ctx);
}
```

### Ordering invariants (must be preserved and documented in index.ts)

1. `negotiationMood` derives from `ctx.lastRoll` (set by regions C/G) — money.ts
   reads it; that's why applyPlan runs AFTER the mid-turn roll.
2. `sceneEnd` fires only `!plan.combatStart`; the auto-close backstop reads
   `runtime.sceneCard.turnCount >= SCENE_TURN_CAP` and `sceneEndReport === null`.
3. `combatStart` runs LAST and only when `ctx.combat === null` (a gun-skill
   reroute this turn wins); it reads `plan.narration` for the count backstop and
   `input.state` (PRE-turn state) for the net-worth ceiling — keep that exact
   source, not `runtime.state`.
4. `syncDockDebt` stays in the orchestrator AFTER applyPlan (it reconciles every
   money move including scene-end wages).
5. npcs.ts keeps both gates: `isPlausibleNpcName` against known non-persons AND
   name-appears-in-this-turn's-narration.

### Steps (each its own commit)

1. **New seam test first** — `llm/applyPlan.test.ts`: hand-build `TurnPlan`
   objects and run the (about-to-be-extracted) apply region against fixture
   state with a seeded RNG; assert state deltas: payout credited + tier clamped,
   purchase/sell move credits+gear, thread opened once (dedup) and resolved,
   npc registered + junk name rejected, scene card updated, auto-close at cap,
   combatStart clamps (≤5 total, tier ceiling, major exempt), combat skipped
   when ctx.combat preset. This test is the point of the refactor — the plan
   application becomes testable WITHOUT a model call. Write it against a thin
   `applyPlan()` extracted verbatim in the same commit (region I+J moved, logic
   untouched).
2. Extract `openFight.ts` + `preActions.ts` (regions B+C). `runPreActions`
   returns `{ lastRoll, combat, engineLines }`; jsonTurn feeds them into
   ApplyCtx and the prompt (engine-lines suffix in the user message unchanged).
3. Extract `narrationBackstops.ts` + `engineLines.ts` helpers.
4. Split `applyPlan.ts` (from step 1) into the per-mechanic files + ordered
   registry, once green.
5. Facade note: `redactMoney` + `isEchoOfPrevious` are imported by tests from
   `./jsonTurn` — keep re-exports in jsonTurn.ts so `redactMoney.test.ts` /
   `antiEcho.test.ts` stay untouched.

### What we deliberately DON'T do
- Don't touch E/F/G's shape (call/fallback/parse-retry, anti-echo,
  enforce-check, mid-turn re-narration). They interleave model calls with
  `messages[]` mutation; extracting them means threading `plannedCall` through
  callbacks for zero collision benefit — features don't land there.
- Don't change `TurnPlan`/schema, prompts, or any emitted line. The transcript
  a player sees must be identical.
- Don't extract region D (prompt assembly) — Plan 1 already shrinks it to two
  imported calls.

### Acceptance
- `applyPlan.test.ts` green before AND after the split into per-file handlers.
- All existing jsonTurn-adjacent tests untouched and green (threads, shop,
  items, payout, redactMoney, antiEcho, jsonStream, sceneMemory…).
- tsc clean, full suite green, dev-server smoke turn plays normally.

### Payoff
A new mechanic today touches jsonTurn in 2–3 places (pre-chip block + plan
handler + sometimes cleanup). After: `applyPlan/<x>.ts` (new file) + registry
line + turnPlan.ts field + engineBridge method + chipKinds entry — jsonTurn.ts
itself untouched. Combined with Plan 1, the two hottest files drop out of the
per-feature diff entirely.

---

## Sequencing

1. Plan 1 step 1 (golden test) → steps 2–4. Small, fast, high confidence.
2. Plan 2 step 1 (seam test + verbatim extraction) → steps 2–5.
3. After both: update CLAUDE.md's "where things live" + the watch-outs if any.

Then the remaining known hotspots (`engineBridge.ts` domain split, `route.ts`
chip builders) get their own plans — engineBridge is next-largest but its
methods already have seams (this doc's pattern applies: free functions over a
narrow ctx + delegating methods).
