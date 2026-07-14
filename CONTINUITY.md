# CONTINUITY.md — Scene Memory Design

*Status: **v1 shipped.** This file now tracks only what's left of the
scene-memory system. For the shipped v1 (scene card, NPC relations, scene
summaries, present-NPC forcing), see the CONTINUITY note in CLAUDE.md.*

The scene is the unit of memory: three tiers — NOW (scene card, working
memory), RECENT (scene summaries, episodic), CANON (NPCs/threads/facts,
semantic). Engine-owned throughout (the invariant: if it matters, the engine
owns it; the model only proposes).

---

## Remaining work

### 1. Facts ledger — CANON tier v2 (deferred per D-2)

Standing facts that outlive scenes and fit neither NPC nor thread:
"banned from the Meridian dock bar", "the Wren's transponder is spoofed",
"Doyle owes you 200¢" (if the scene ended before payment).

- `TurnPlan.facts: [{text, entityRefs?}]` — model proposes; engine stores on
  the campaign runtime, **capped at 20**, deduped by fuzzy text match, oldest
  evicted. All 20 ≈ ~200 tokens — small enough to send the relevant slice (or
  all, v1) every turn.
- Facts referencing an entity ride retrieval like threads do.

### 2. Shrink the verbatim history window 10 → 6 exchanges (D-3)

Once summaries have proven out in a playtest cycle, shrink the verbatim history
from ~10 to ~6 exchanges. The 4 dropped exchanges are exactly the ones the scene
summaries now cover better than raw text did. **Not a same-commit change** — do
it after summaries have run in play, so a regression is easy to attribute.

### 3. Bug — summarizer persists raw truncated JSON

Some scene summaries have been persisted as **raw truncated JSON** (e.g.
`{\n "summary": "...`) instead of clean prose text. The summarizer's output
parsing needs to extract the `summary` field (and fall back cleanly on a parse
failure) rather than storing the model's raw JSON string. Fix the parse path in
`llm/summarizer.ts`.

---

## Locked decisions (don't re-litigate)

- **D-2** Facts ledger is the deferred v2 canon slice (above).
- **D-3** Verbatim history shrinks 10 → 6 one playtest cycle after summaries
  land (not same-commit).

## Flags still relevant to unbuilt work

- **F-3 — summarizer failure loses a scene.** On summarize failure, store a
  deterministic fallback (first + last player action + engine lines) so the
  scene is never a hole. (Related to the raw-JSON bug above.)
- **F-4 — facts junk accumulation.** Caps + dedupe; facts LRU at 20.
- **F-5 — snapshot bloat.** The Scene schema has a `snapshot` field (full state
  per scene, for rewind). NOT part of this design — leave unused; summaries
  only. Revisit if rewind becomes a feature.
- **F-6 — double memory in multiplayer.** Scene rows are campaign-scoped
  (private). Cross-campaign canon stays the world_events feed (MULTIPLAYER.md);
  this system never leaks a private scene into the shared universe.
