# CONTINUITY.md — Scene Memory Design

*Status: **decisions locked, ready to build.** The continuity system — scenes as
the unit of memory.*

**Locked decisions (2026-07-13):**
- **D-1** Auto-close backstop: engine forces a scene boundary after **12 turns**
  of one scene **or on location change**; model `sceneEnd` remains the natural
  boundary.
- **D-2** Facts ledger (canon tier) **deferred to v2** — v1 ships the scene card
  + summaries + scene retrieval.
- **D-3** Verbatim history shrinks **10 → 6 exchanges** one playtest cycle after
  summaries land (not same-commit).

---

## 1. The problem (observed in playtests)

Characters, promises, and situations vanish after ~5–10 exchanges. Root causes,
in order of severity:

1. **The history cliff.** The narrator sees the last 10 exchanges verbatim
   (`history.slice(-20)`) and *nothing* summarizes what scrolls off. The
   CLAUDE.md line "older context is carried by scene summaries" is aspirational
   — `summarizeScene` exists but is **never called**; `scenes` (schema, DB
   table, SessionData field) is dead infrastructure from an earlier milestone.
2. **Retrieval is name-triggered.** `retrieveEntities` surfaces an NPC only if
   the player *names them this turn* (or location/faction match). "I go back to
   see him" retrieves nothing.
3. **No working memory.** Nothing tracks the *current* scene's short-term state:
   who is in the room, what was just agreed, what the player is mid-way through.
   The model reconstructs it from raw history every turn — until history rolls.

The NPC register (turnPlan.npcs → `registerNpc`) fixed *who exists*. This design
fixes *what's happening and what happened*.

## 2. Design: three memory tiers, scene as the unit

Human-memory shaped, engine-owned (the invariant: if it matters, the engine owns
it — the model only proposes).

```
┌────────────────────────────────────────────────────────────┐
│ NOW      Scene Card       working memory   ~150 tok  every turn │
│ RECENT   Scene Summaries  episodic memory  ~250 tok  last 3 + retrieved │
│ CANON    NPCs/Threads/Facts semantic memory ~existing + facts │
└────────────────────────────────────────────────────────────┘
```

### 2a. NOW — the Scene Card (new)

A small structured block describing the current scene, maintained by the
ENGINE, sent with every query:

```
SCENE NOW (scene 7, turn 4 of this scene)
Where: Rook Station — the Undertow bounty desk
Present: Quartermaster Doyle (npc-gen-doyle), Vex the fence (npc-gen-vex)
Situation: Delivering the recovered manifests; Doyle is verifying the seals.
Open this scene: Doyle promised 200¢ on verification · Vex wants a private word
```

- **Engine-owned fields:** scene seq, turn count, location (from state),
  `present` (NPC ids — union of NPCs registered/used this scene + retrieval
  focus). These cannot drift.
- **Model-maintained fields** (via new `TurnPlan.scene` object, all optional):
  - `situation` — one sentence, "what is happening right now" (overwrites).
  - `beats` — append-only micro-facts of promises/agreements/threats made this
    scene ("Doyle promised 200¢", "guard saw your face"), max ~6, engine caps.
- Present-NPC tracking also solves retrieval failure #2: NPCs in `present`
  ride into the context *every turn of the scene* without being re-named.

### 2b. RECENT — scene summaries, wired for real

The dead pipeline comes alive:

- On `sceneEnd`, the route fires a **background** summarize (like creation's
  `after()` pass): the scene's transcript slice → `summarizeScene` →
  a `Scene` row `{seq, title, locationId, summary, entityRefs}` persisted to
  the existing `scenes` table. Never blocks a turn; worst case the next turn
  lacks the newest summary for a few seconds.
- **Every prompt carries `PREVIOUSLY`**: the last 3 scene summaries, newest
  last, ~2-3 sentences each. This is the rolling "story so far".
- **Older scenes are retrieved**: `retrieveEntities` gains a scene scorer —
  summaries whose `entityRefs` intersect the turn's named entities/focus (or
  whose title tokens overlap) get pulled in (max 2). Revisit Doyle ten scenes
  later → the Doyle scenes surface.
- The scene card's `beats` are folded into the summarizer input, so promises
  survive compression ("Doyle still owes the 200¢" ends up in the summary).

### 2c. CANON — durable facts ledger (small, new)

Standing facts that outlive scenes and fit neither NPC nor thread:
"banned from the Meridian dock bar", "the Wren's transponder is spoofed",
"Doyle owes you 200¢" (if the scene ended before payment).

- `TurnPlan.facts: [{text, entityRefs?}]` — model proposes; engine stores on
  the campaign runtime, **capped at 20**, deduped by fuzzy text match, oldest
  evicted. All 20 ≈ ~200 tokens — small enough to send the relevant slice (or
  all, v1) every turn.
- Facts referencing an entity ride retrieval like threads do.

## 3. Token budget (per turn)

| Block | Cost |
|---|---|
| Scene card | ~120–180 |
| PREVIOUSLY (3 summaries) | ~200–300 |
| Retrieved older scenes (0–2) | 0–150 |
| Facts (v1: all) | ~100–200 |
| **Added** | **~450–800** |
| History shrink 10 → 6 exchanges | **−600–1000** |

Net ≈ free, likely cheaper — and the 4 dropped verbatim exchanges are exactly
the ones the summaries now cover better than raw text did.

## 4. Scene lifecycle

```
scene starts (campaign start, or previous sceneEnd)
  │  engine: seq++, turnCount=0, present=[], beats=[], situation=""
  ▼
each turn: turnCount++; model may update situation / append beats;
           registerNpc / retrieval adds to present
  ▼
sceneEnd (model-declared)  ──or──  auto-close backstop (see F-1)
  │  route: background summarize(transcript slice + beats) → Scene row
  │  next turn: new card, PREVIOUSLY includes the fresh summary
  ▼
scene starts …
```

## 5. Build order

1. **Scene card + present-NPC tracking** (engine struct on SessionData/runtime,
   TurnPlan.scene, prompt block) — kills the "who's in the room" failures.
2. **Wire the summarizer** (sceneEnd → background summarize → scenes table →
   PREVIOUSLY block) — kills the history cliff.
3. **Scene retrieval** (score summaries in retrieveEntities).
4. **Facts ledger** — smallest, most deferrable.
5. **Shrink history window** 10 → 6 once 1–2 are proven in play.

## ⚠ Flags

- **F-1 — scenes that never end.** DeepSeek under-fires `sceneEnd` (same class
  as the combatStart backstop I-2). Without a boundary, summaries never
  generate and the card grows stale. **Backstop: auto-close after K turns**
  (propose K=12): engine forces a scene boundary, summarizer runs, card resets
  (location carries over). Also auto-close on location change.
- **F-2 — model-maintained fields can drift/hallucinate.** Mitigation: the
  model only writes `situation` (overwritable, 1 sentence) and `beats`
  (append-only, capped); everything else is engine-derived. Engine facts always
  win on conflict (location, who's present).
- **F-3 — summarizer failure loses a scene.** Mitigation: on summarize failure,
  store a deterministic fallback (first + last player action + engine lines) so
  the scene is never a hole; retry next sceneEnd is not needed.
- **F-4 — beats/facts junk accumulation.** Caps + dedupe; beats die with the
  scene (only what the summarizer keeps survives); facts LRU at 20.
- **F-5 — snapshot bloat.** The Scene schema has a `snapshot` field (full state
  per scene, for rewind). NOT part of this design — leave unused; summaries
  only. Revisit if rewind becomes a feature.
- **F-6 — double memory in multiplayer.** Scene rows are campaign-scoped
  (private). Cross-campaign canon stays the world_events feed (MULTIPLAYER.md);
  this system never leaks a private scene into the shared universe.
