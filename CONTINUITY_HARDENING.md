# CONTINUITY HARDENING — implementation handoff

*Written 2026-07-17 as a handoff for implementation. Context: a live analysis of
a 164-turn campaign (Lyra Vale, `camp-mrnw51dj-ac2a`) traced "the narrator keeps
forgetting things" to specific mechanical failures in the memory tiers. The
reactive fixes are SHIPPED (analyst off the thinking model, summary telemetry,
degraded-scene self-repair, analyst-written facts, NPC aliases). This document
is the remaining PROACTIVE work, in priority order. Each task is self-contained:
goal, exact files, steps, tests, done-criteria.*

**Read first: CLAUDE.md (invariant + multi-window rules), CHECKS.md (the check
registry — every task here adds rows to it), CONTINUITY.md (memory design).**

## Standing rules for every task below

- **The invariant**: engine does all math/state; the LLM only narrates and
  proposes. Never add a prose rule for something the engine can enforce.
- **No story retro-edits.** Never rewrite persisted narrative content (scene
  summaries that are merely *bad*, relation notes, transcripts). Replacing a
  FAILED compression with a working one (the degraded-repair path) is allowed;
  editing story that played out is not.
- **Multi-window discipline** (CLAUDE.md): another Claude window may share this
  working tree and DB. `git fetch && git pull --rebase origin main` before
  committing; stage ONLY your own files by explicit path; if `git diff --cached`
  shows files you didn't touch, `git restore --staged` them. Reconcile migration
  numbers against live `list_migrations` (Supabase MCP, project
  `mgsogqnrpvoblqxkfgge`) and use `node scripts/next-migration.mjs`.
- **Verify with** `npx tsc --noEmit` + `npx vitest run` FROM `drift/` — never
  `npm run build` while the dev server runs. All ~760 tests must stay green.
- **Golden snapshot** (`llm/contextSlice.golden.test.ts`): if a prompt-text
  change is intentional, re-bless with `-u`, then `git diff` the `.snap` and
  verify the diff contains ONLY your lines before committing.
- Commit each task separately with the repo's message style (`fix(scope): …`
  body explaining the born-from incident). End commits with the Co-Authored-By
  trailer per CLAUDE.md.

---

## Task 1 — Fix the transcript-trim index drift (BUG, do first)

**The bug.** `sceneCard.startTranscriptIdx` is an absolute index into the
`transcript` array recorded when a scene opens. The transcript is capped at 400
entries by `.slice(-400)` at four sites in `app/api/turn/route.ts` (~lines 281,
408, 434, 795 — grep `slice(-400)`). When the cap trims N old entries off the
front, every element shifts left N positions but the stored index does not, so:

- scene compression (`compressClosedScene`: `transcript.slice(closedCard.startTranscriptIdx)`)
  and the mid-scene analyst (`lib/analystRun.ts` ~117-119) slice a window that
  starts too LATE — the summary covers only the scene's tail;
- when drift ≥ scene length, the slice is EMPTY and `compressClosedScene`
  early-returns: **no scene row at all** — a silent, unflagged memory hole;
- drift is zero until a campaign reaches 400 entries, then grows every turn —
  which is why the heaviest campaigns had the worst memory.

Confirmed: no code anywhere re-baselines the index (grep `startTranscriptIdx`).

**Design: centralize append+trim, adjust the index in one place.**

1. New helper in `shared/chat.ts` (where `ChatEntry` lives):

   ```ts
   /** Append entries and enforce the 400-entry cap, RE-BASING the open scene's
    *  startTranscriptIdx by however many entries the trim dropped — the index
    *  is positional, and an at-cap campaign drops entries every turn (the
    *  silent memory-hole bug: at cap, scene closes sliced an empty window and
    *  wrote NO summary row). Mutates sceneCard in place (session-owned). */
   export const TRANSCRIPT_CAP = 400;
   export function appendTranscript(
     transcript: ChatEntry[],
     adds: ChatEntry[],
     sceneCard: { startTranscriptIdx: number },
   ): ChatEntry[] {
     const combined = [...transcript, ...adds];
     const dropped = Math.max(0, combined.length - TRANSCRIPT_CAP);
     if (dropped > 0) {
       sceneCard.startTranscriptIdx = Math.max(0, sceneCard.startTranscriptIdx - dropped);
     }
     return combined.slice(-TRANSCRIPT_CAP);
   }
   ```

2. Replace ALL FOUR `.slice(-400)` sites in `app/api/turn/route.ts` with
   `appendTranscript(session.transcript, adds, session.sceneCard)`. Note the
   ~795 site computes `newTranscript` BEFORE the scene-close logic that reads
   `closedCard.startTranscriptIdx` — make sure the rebase happens before
   `closedCard` is captured, or capture the card AFTER calling the helper (read
   the surrounding code carefully; the closed card and the live card may be
   different objects — `carryScene(closedCard, newTranscript.length)` opens the
   next scene with a fresh index, which stays correct because it's computed from
   the POST-trim length).
3. Defense in depth in `compressClosedScene`: if the computed slice is EMPTY but
   the scene had turns, do NOT early-return silently — fall back to the last
   ~30 transcript entries, produce the F-3 stub, and mark the row `degraded`
   with that fallback slice as `raw_slice` (the self-repair machinery from
   migration 026 then owns it). A hole must never be silent again.
4. Check `lib/state.ts` `persistSession`/load paths for any other `.slice(-400)`
   or transcript-cap logic (grep repo-wide) and route them through the helper.

**Tests** (new `shared/chat.test.ts` or extend an existing suite):
- under cap: append doesn't change `startTranscriptIdx`;
- at cap: appending 3 entries drops 3 and decrements the index by 3;
- index clamps at 0;
- realistic sequence: open scene at idx 380 of 400, append 36 entries across
  turns, assert final idx = 344 and `transcript.slice(idx)` returns exactly the
  scene's entries.

**Done when:** tsc + full suite green; the four route sites use the helper; an
at-cap scene close demonstrably slices the correct window (assert in test).
Add a CHECKS.md §1 row (born-from: the Lyra at-cap silent-hole finding).

---

## Task 2 — Optimistic concurrency on `campaign_runtime` (last-write-wins clobber)

**The risk.** `persistSession` → `saveCampaignRuntime` (db/queries.ts) is a
whole-row upsert of EVERY runtime slice. Writers have multiplied: the live turn,
background scene compression, the mid-scene analyst, degraded repair, manual
re-sync — all call `persistSession`. A background pass finishing during a
player's turn persists a STALE copy of `facts`/`npcRelations`/`jobs` over the
turn's fresh one. `updated_at` is written but never checked (the long-deferred
optimistic-lock item — now load-bearing).

**Design: compare-and-swap, with a narrow merge on conflict.** Perfect merging
is NOT required at playtest scale; the goal is "no silent clobber."

1. `db/queries.ts`: `CampaignRuntime.updatedAt` already exists on load. Change
   `saveCampaignRuntime` to accept `expectedUpdatedAt?: string`:
   - when provided: `UPDATE … WHERE campaign_id = X AND updated_at = expected`
     (use `.update(...).eq("campaign_id", id).eq("updated_at", expected).select("campaign_id")`
     and treat 0 returned rows as a CONFLICT); if the row doesn't exist yet,
     fall back to insert.
   - when absent (first save / keyless): current upsert behavior.
   - return `{ conflict: boolean }`.
2. `lib/state.ts`: `SessionData` gains `runtimeUpdatedAt?: string` — set on load
   (from `runtime.updatedAt`) and refreshed after every successful persist (the
   save should return the new timestamp; generate it in JS and pass it in so
   you know its value without a re-read).
3. `persistSession(campaignId, session)` on CONFLICT:
   - re-load the fresh runtime row;
   - MERGE the background-owned slices into the in-memory session before one
     retry: `facts` via `applyFactUpdates(theirs, mine-as-additions)` (dedupe
     handles overlap); `recentScenes` union by `seq`, preferring the
     non-degraded entry (then the longer summary); `npcs` union by id,
     preferring the entry with more filled fields (aliases/oneBreath/role);
   - everything else (state, transcript, history, jobs, relations, sceneCard):
     the IN-MEMORY session wins — the player's turn is authoritative;
   - retry the save ONCE with the fresh `expectedUpdatedAt`; if it conflicts
     again, force-write unconditionally and `console.warn` (never fail a turn
     over bookkeeping).
4. Extract the three merge functions as PURE exports (e.g. in
   `shared/runtimeMerge.ts`) so they're unit-testable model-free.

**Tests:** pure merge functions — facts overlap dedupes; recentScenes prefers
healed over degraded for the same seq; npcs union keeps the richer record.
DB paths are best-effort (no DB in tests) — the pure layer is the contract.

**Done when:** two interleaved `persistSession` calls can't silently drop a
background writer's facts/scenes (demonstrated via the pure merges + the CAS
wiring reading correctly); CHECKS.md §0 row added; the "optimistic-lock
deferred" bullets in CLAUDE.md's Small-deferred list and CONTINUITY notes are
updated to SHIPPED.

---

## Task 3 — The continuity gym (executable regression harness)

**Goal.** Every existing check was born from a live incident. Turn the registry
proactive: a scripted, MODEL-FREE multi-scene harness that replays canned
sessions through the real engine seams and asserts that established context
SURVIVES window turnover. This is also the acceptance harness for the planned
world reboot.

**Design.** No model calls, no jsonTurn changes: drive the same seams the unit
tests already use — `TurnRuntime` + `applyPlan(plan, ctx)` for turns,
`applyAnalystUpdates(...)` for scene closes, `buildContextSlice(...)` for
assertions. New file `llm/continuityGym.test.ts` (mirror `applyPlan.test.ts`'s
fixture style; consider a small `gym()` helper that owns a session-shaped
accumulator: state, sceneCard, npcRelations, recentScenes, facts, transcript).

Script these scenarios (each is one `it(...)`):

1. **Facts survive the window.** Turn 3 applies a plan with
   `facts:[{text:"Split with Kaela: 50/50 — agreed"}]`; simulate 15+ scene
   closes (carryScene + pushing scripted summaries into recentScenes); assert
   `buildContextSlice` at "turn 35" still contains `50/50` under ESTABLISHED
   FACTS, and that a later
   `facts:[{text:"Split with Kaela now 60/40 — renegotiated"}]` REPLACES it
   (one Kaela fact, the new wording).
2. **Aliases never fork.** Register "Ren" (courier), then a plan npcs-entry
   introduces "Ren" with role fixer whose oneBreath names "Renwick Duross" →
   assert cast has exactly TWO records ("Ren", "Ren (fixer)" with alias
   Renwick); a later plan entry `{name:"Renwick"}` adds NOTHING; retrieval for
   player text "ask renwick about the wreck" surfaces `Ren (fixer)`.
3. **Scene-summary continuity.** A promise made in scene 2 (scripted summary
   "Promised Dex a meet at the Rust Bucket") still appears in the PREVIOUSLY
   block 10 scenes later (recentScenes keeps last 20); assert it's gone after
   21 more scenes (cap respected — and the FACT version, if recorded, still
   present: the tiers complement each other).
4. **Trim safety (uses Task 1's helper).** Build a 400-entry transcript, open a
   scene, append 30 entries through `appendTranscript`, close — assert the
   scene's slice equals exactly the 30 scene entries (not empty, not the tail).
5. **Home gate + companion exemption.** A remote-based NPC quoted over comms
   never enters presence; a companion present last scene survives a location
   change.
6. **Facts cap.** 21 distinct-subject facts → oldest evicted, newest 20 kept.

**Done when:** the file runs green in the normal suite, model-free, < a few
seconds; a "continuity gym" row is added to CHECKS.md §0; a short section is
added to CONTINUITY.md pointing reboot acceptance at the gym.

---

## Task 4 — Retrieval by role token (the "harbormaster" gap)

**Goal.** Retrieval (`llm/retrieval.ts`) scores name/alias tokens only. Players
reference people by ROLE ("ask the harbormaster") — those misses drop the NPC
from context. Cheap fix, real coverage.

1. In the scoring loop (after the name/alias block): if `n.role`, tokenize it
   (`/[a-z0-9]+/g`, tokens ≥ 4 chars) and if any token is in `textTokens`,
   `score += 30; named = true;` (named=true so focus carries — a player talking
   to "the harbormaster" keeps them in focus next turn). Do NOT apply the +60
   full-phrase tier to roles; 30 keeps roles below explicit names.
2. Guard: skip role scoring for the patron (`isPatronNpcId`) like the other
   passive signals (see the comment block already there — the Steward bug).
3. Tests: new cases in the retrieval test file (or create
   `llm/retrieval.test.ts` if none): "ask the harbormaster about berths"
   retrieves Quist-shaped fixture; a role word inside an unrelated sentence
   ("the fixer's price") retrieves the fixer; patron role words do NOT retrieve
   the patron.

**Done when:** tests green; golden unchanged (retrieval affects selection, and
fixtures shouldn't shift — if the golden moves, inspect and re-bless only if
the change is genuinely just added NPCs in fixtures).

---

## Task 5 — Ledger hygiene: grounding + pinning

**Goal.** Facts are durable canon written by a cheap model — poisoning and
eviction-of-load-bearing-facts are the failure modes.

1. **Grounding (prompt-only):** tighten the `facts` spec in BOTH
   `llm/jsonSystem.ts` rule 10 and `llm/summarizer.ts` ANALYST_SYSTEM: a fact
   must be DIRECTLY evidenced by what was said/done — never inferred, never a
   prediction ("X will probably…"), never scene color. (Golden re-bless for the
   jsonSystem line; verify diff.)
2. **Pinning:** `shared/facts.ts` — `Fact` gains `pinned: z.boolean().optional()`.
   `applyFactUpdates` eviction becomes: evict oldest UNPINNED first; pinned
   facts only evict when everything is pinned (then oldest). Cap pinned at 8 —
   a 9th pin unpins the oldest pinned. The ANALYST may set
   `"pinned": true` for deal terms/kinship (add to its facts spec:
   "pin ONLY terms whose loss would contradict the story — deals, kinship,
   debts"); the live turn path canNOT pin (don't add it to TurnPlan).
3. Surface pins in the prompt section (`llm/promptSections/facts.ts`): render
   pinned facts first, no other visual change.
4. Tests (`shared/facts.test.ts`): pinned fact survives 25 unpinned additions;
   unpinned still LRU-evict; the 9th pin unpins the oldest pinned; a restated
   pinned fact keeps its pin.

**Done when:** tests green; CHECKS.md facts row updated with the
grounding+pinning notes.

---

## Task 6 — "What the game remembers" (player-visible memory + correction loop)

**Goal.** Players are the best inconsistency detectors (three appeals found the
Ren tangle before any tooling). Show them the memory; give them a one-tap flag.

1. `components/sidebar/StoryTab.tsx` (inside the existing DetailsModal): add a
   "The game remembers" section listing `facts` (text + tenday, pinned first,
   📌 marker) above/below the existing scene-history content. Facts need to
   reach the client: `app/api/state/route.ts` — expose `facts` in the payload
   (mirror how `jobs`/`playerLedger` are exposed); thread through
   `PlayClient` → `Sidebar` → `DetailsModal` → `StoryTab` props (follow the
   `playerLedger` plumbing exactly).
2. Per fact, a small "flag" button ("this is wrong") that POSTs to the EXISTING
   feedback endpoint (`app/api/feedback` — see how the 💡 Request modal submits)
   with prefilled text: `Memory correction: "<fact text>" is wrong — ` and lets
   the player append why. NO direct state mutation — corrections are triage
   input, not writes (engine-owns-writes invariant; a future analyst directive
   can consume them).
3. Keep it read-only and compact; no new endpoint, no new table.

**Done when:** tsc green; facts visible in the Story tab with working flag →
feedback submission; CHECKS.md §6 row ("player memory-correction loop").

---

## Task 7 — D-3 window shrink (GATED — do not start until criteria met)

**What it is.** The verbatim model history is `slice(-20)` (~10 exchanges) in
`app/api/turn/route.ts` (~line 291 and the other history-persist sites — grep
`slice(-20)`). D-3 (CONTINUITY.md locked decision) shrinks it to ~6 exchanges
(`slice(-12)`) — saves tokens on every turn and PROVES the compressed tiers
carry the story.

**Gate — all three, in order:**
1. Task 1 shipped (trim bug fixed — summaries trustworthy at cap);
2. ~1 week of play with healthy `summary` telemetry: in `ai_calls` kind
   `summary`, error-rate < ~5% and no new `degraded` scene rows being created
   (SQL: `select count(*) from scenes where degraded and ended_at > now() - interval '7 days'`);
3. The continuity gym (Task 3) green — including scenario 3.

**Then:** one commit changing ONLY the history-window constant(s), clearly
labeled, nothing else in it (attributability is the point). Watch the next
days' appeals/feedback; revert is the single-line rollback.

---

## Suggested CHECKS.md bookkeeping

Each task lands a row in the matching family (§0 architecture for Tasks 2-3,
§1 memory for Task 1, §2 people for Task 4, §1/§6 for Tasks 5-6). Follow the
existing row format: Check | Where | Fires | Catches / born from — and name the
born-from incident (Tasks 1-2: the Lyra at-cap analysis, 2026-07-17).
