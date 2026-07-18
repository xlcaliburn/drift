# HANDOFF — Story slice 2 (3a): the content machinery — cast depth, reveals, sidequests, signature rewards

*Strategy phase output (Fable, 2026-07-18). **FULLY SHIPPED 2026-07-18** —
all four tasks annotated below. Design source: `STORY.md` §1-2 + the owner's
four locked calls (2026-07-18): thin-wrapper sidequests, chapter-gated
reveals, signature rewards in scope, machinery-first-then-content. This
slice is the LAST machinery before the season script (3b) — everything here
ships DORMANT (live pack authors nothing yet) and proven against test-only
stubs, exactly like HANDOFF_STORY_1.*

## Why this slice exists (what the review of the build order found)

STORY.md's build order called slice 3 "content, not code" — it isn't. Three
things the content depends on have no runtime: the `backstory/secret/arc`
fields Task B of STORY_1 added to `PackNpc` reach NOTHING (dead fields);
`pack.sidequests` doesn't exist; storyline rewards are credits+rep only. And
the obvious implementation of the first one is a TRAP (see below) — hence a
decision-final handoff rather than letting the implementer guess.

## ⚠ THE TRAPS for this handoff

1. **`seedNpcs` is NOT the wiring point for authored cast depth.** The seed
   cast loads from the DB `npcs` table (`db/queries.ts` `loadCampaignState`,
   `origin_campaign_id IS NULL`) — `seedNpcs` only runs at universe
   CREATION. Copying `backstory/secret/arc` there ships a dead feature for
   the live universe. Persisting them instead is wrong three ways: needs
   columns+backfill, kills hot-editability, and **leaks secrets to the
   client** (`state.npcs` rides `/api/state` to the browser — a persisted
   `secret` is readable in devtools). Authored depth is PACK-ONLY, read
   live by NPC id at prompt-render time, never persisted, never sent to the
   client. Same hot-editable pattern as storyline chapters themselves.
2. **Secrets have TWO existing leak surfaces Task B's gate doesn't cover.**
   `promptSections/world.ts` feeds `[hook: ${n.backstory}]` for every
   present NPC, and `promptSections/npcTiers.ts` + `generatePersonalJob`
   surface `npc.backstory` as the trusted-tier want / a PLAYER-VISIBLE job
   blurb. Therefore: authored `backstory` is by CONTRACT the spoiler-safe
   summary (STORY_AUTHORING.md will say so); only `secret` carries the
   reveal, and only the Task B section ever renders it. The personal-favor
   machinery stays on the persisted/generated backstory — do NOT overlay
   authored depth into `npcTiers`/`generatePersonalJob` this slice.
3. **The sidequest one-shot guard is FREE — do not build a runtime slice
   for it.** `refreshBoard` only ever prunes OFFERED jobs
   (`shared/quests.ts` — `j.status !== "offered"` passes through), so
   completed/failed/active jobs persist in the `jobs` slice forever. "A job
   with this sidequest's id already exists in `jobs[]`" IS the one-shot
   record. No migration, no new `campaign_runtime` column, no load
   normalization, no rollback wiring. And the semantics come out RIGHT for
   free: an EXPIRED ignored offer drops out of the array → re-offerable on
   a later visit; a completed or abandoned (`failed`) one persists → never
   again. One-shot scopes to taken-and-resolved, never to merely-offered.
4. **Golden BYTE-IDENTICAL, again.** Both new prompt sections return `[]`
   while dormant (no authored depth on the pack, no active chapter, no
   sidequests). The golden fixture retrieves `npc-broker` — a PACK cast id
   — so note for 3b: the moment content authors depth for the seed cast,
   the golden legitimately moves and gets a deliberate re-pin. In THIS
   slice it must not move at all.
5. **A signature item reward must ride the full-pack machinery.** Granting
   an act-finale unique into a full pack would silently lose it — the exact
   class `sceneCard.pendingPickup` + the swap chips (ITEMS.md slice B)
   exist for. The reward payout routes through the same pickup path the
   loot flow uses, never a blind `gear.push`.
6. **Stubs are TEST-ONLY.** Live pack ships `sidequests: []` and zero
   authored depth. Same rule as STORY_1 trap 3.

## Task A — authored cast depth: the pack-only live overlay — ✅ SHIPPED 2026-07-18

1. `content/pack/index.ts` (or a small helper module): export
   `authoredCastDepth(npcId): { backstory?: string; secret?: string; arc?: string[] } | undefined`
   — a map built once from `pack.cast`. This is the ONE read path for the
   depth fields; nothing persists them.
2. `promptSections/world.ts`: the hook line prefers authored backstory —
   `[hook: ${authored?.backstory ?? n.backstory}]` (authored > persisted >
   nothing; the existing `n.backstory` behavior is unchanged for
   non-authored NPCs). `seedNpcs` is NOT touched.
3. Doc comment on `PackNpc.backstory` updated to state the contract:
   spoiler-safe, player-adjacent (it can surface in hooks and wants);
   `secret` is where the reveal lives.

**Tests:** authored backstory wins the hook line; an NPC without authored
depth falls back exactly as before; nothing in `/api/state`'s payload ever
carries `secret` (assert the state route's npc shape); golden unchanged.

**Shipped as specced**, with one substitution: `/api/state` isn't unit
tested anywhere in this codebase (no `app/api/*` route has a direct test —
that layer sits outside the vitest suite's scope), so "nothing in the
payload carries `secret`" is proven as a STRUCTURAL guarantee instead: the
state-level `Npc` zod schema has no `secret`/`arc` field at all, and
`content/pack/pack.test.ts` pins that `seedNpcs`' explicit field list
(id/universeId/name/oneBreath/factionId/locationId/role) can't pass them
through even if a pack cast entry carried them. `buildAuthoredCastDepth` was
also extracted as a standalone pure function (not in the spec) so the
map-building logic is unit-testable without depending on the live (empty)
pack.

## Task B — chapter-gated reveals (`secret` + `arc`) — ✅ SHIPPED 2026-07-18

1. New `llm/promptSections/castReveals.ts` + ONE registry entry. Renders
   ONLY when a storyline chapter is ACTIVE (read `storyline` from
   `SectionCtx`, the pack chapter live):
   - For each ACTIVE-chapter `castNpcIds` member who is PRESENT
     (`sceneCard.presentNpcIds`) and has an authored `secret`: a REVEAL
     directive — "you may now let <name>'s secret surface, on your timing:
     <secret>". The gate is chapter-active + present, both engine facts.
   - For each present authored-cast member with an `arc`: feed
     `arc[act-1]` (current act = the ACTIVE chapter's act) as "how they
     are in this act: …". No active chapter → no arc line (act is
     undefined without one; keep it simple this slice).
2. Returns `[]` whenever there is no active chapter → golden safe (trap 4).

**Tests:** secret renders only with (active chapter ∧ cast member ∧
present) — all three individually falsified; arc picks by act; dormant
pack renders nothing.

**Shipped as specced.** `castReveals.ts` mirrors `activeChapter.ts`'s
established shape exactly (imports `pack` directly, reads `storyline` +
`memory.sceneCard` from `SectionCtx`) — no new `SectionCtx` field or
`buildContextSlice` parameter needed, since everything it reads was already
threaded. Registered right after `activeChapter` in the same context group.

## Task C — sidequests: authored, placed, one-shot (thin wrapper on Job) — ✅ SHIPPED 2026-07-18

1. **Schema** (`content/pack/types.ts`): `PackSidequest = { id (unique,
   prefix-free — the runtime prefixes it), title, blurb, giverNpcId (a pack
   cast id), factionId?, tier ("T0".."T3"), postedLocationId, trigger?
   { actAtLeast?, factionRepAtLeast?, npcTrustAtLeast?, hasFact? },
   objectives: PackStoryObjective[] (min 1 — REUSE the storyline objective
   schema, all kinds incl. report), cargo?, complication?, reward
   { repFactionId?, repDelta? } }`. `ContentPack` gains
   `sidequests: PackSidequest[]` (default []); the drift pack ships `[]`
   (`content/pack/drift/sidequests.ts`, mirroring storyline.ts).
   `validatePack`: ids unique; giver/location/faction/objective refs
   resolve; `actAtLeast` only meaningful 1-3.
2. **Materialization** (`shared/quests.ts` or a small `shared/sidequests.ts`):
   `sidequestJob(sq, tenday): Job` — id `sq-<sq.id>`, `archetype:
   "authored"`, `giver: sq.giverNpcId`, `postedLocationId` from the pack,
   objectives mapped with `done: false`, cast = ONE giver entry carrying
   the REAL pack npc id/name (so `materializeJobCast`'s adopt-by-id/name
   path attaches the real person, never a phantom), reward tier = sq.tier
   (authored tier is canon — NOT clamped by `payoutCeiling`; an authored
   quest's stakes are the author's call), `expiresTenday: tenday + 3` like
   any offer.
3. **Injection** (pure): `injectSidequests(pack, jobs, state, storyline,
   npcRelations, facts, tenday): Job[]` — for each pack sidequest whose
   `postedLocationId` is HERE, whose trigger holds (act from the storyline
   slice — highest active-or-complete chapter's act, 0 when dormant; rep /
   trust / fact predicates same style as `triggerMet`), and whose `sq-<id>`
   job id does NOT already exist in `jobs[]` (trap 3 — any status counts),
   append the materialized offer. Injected offers COUNT toward
   `BOARD_SIZE` (an authored offer displaces a generated one — call
   injection before `refreshBoard`'s top-up in `resolveJobsTurn`, and in
   `/api/state`'s first-read seed path, both through this one helper).
4. From the moment it's offered, a sidequest IS a job: accept/abandon
   chips, `inferJobAccept` (title tokens), cargo grant, cast
   materialization, `advanceJobs`, payout — all existing machinery,
   untouched. The `offeredJobs` section needs zero changes (no seam).

**Tests:** a 2-sidequest TEST stub — placement (only offered HERE),
trigger gating (act/rep/fact each falsified), one-shot (complete → never
re-injected; failed → never; EXPIRED-and-dropped → re-injected next
visit), board displacement (4 offers max with an injected one present),
materialized giver adopts the real pack NPC, reward tier unclamped.
`pack.test.ts`: validatePack rules + live pack ships zero sidequests.

**Shipped as specced**, plus one real bug found and fixed during
implementation (not in the original spec): the existing personal-job
arc-resolution block in `shared/jobsRuntime.ts` (`giver !== "board" &&
rel.arcStage !== "resolved"`) would have falsely resolved an arc the moment
ANY sidequest's giver was an npc the player already had prior standing
with — a sidequest never sets `arcStage:"active"` at accept the way
`generatePersonalJob` does, so an undefined `arcStage` slipped through the
old `!== "resolved"` check and permanently blocked that NPC's real
personal-favor offer (`personalJobAvailable` requires `!rel.arcStage`).
Fixed by tightening the gate to `rel.arcStage === "active"` — a correctness
fix independent of sidequests, exposed by this new giver-is-npc job type,
with a regression test and zero behavior change for the existing (only)
caller (`generatePersonalJob`'s accept path already sets `"active"`).

## Task D — signature rewards + docs close-out — ✅ SHIPPED 2026-07-18

1. `PackStoryChapter.reward` gains `itemId?` (a `shared/items` CATALOG id —
   validatePack checks it resolves) and `crewUnlock?` (a pack cast npc id).
2. `storylineRuntime.resolveStorylineTurn` payout: `itemId` grants through
   the SAME pickup path loot uses — item fits → into gear with a 📖 line;
   pack full → `sceneCard.pendingPickup` + the existing swap chips (trap
   5; this needs the sceneCard threaded into the resolve input — keep the
   function pure, return the grant-or-pending outcome for the route to
   apply if threading the card in is invasive). `crewUnlock` raises the
   NPC's relation to recruit-eligibility: disposition to at least
   `TRUST_THRESHOLD` (never lowered) + a relation-log line — `recruitOffer`
   still gates on berth/presence as normal.
3. Docs: STORY_AUTHORING.md gains the cast-depth contract (backstory
   spoiler-safe / secret gated / arc per act), the sidequest format
   field-by-field, and signature rewards; STORY.md build order splits 3
   into 3a (this, SHIPPED) / 3b (the script); STATUS.md; CLAUDE.md docs
   map; CHECKS.md rows (pack-only depth = no leak surface; sidequest
   one-shot-via-jobs-slice); annotate THIS handoff per WORKFLOW.md.

**Shipped as specced**, with the "invasive" question resolved in favor of
keeping `resolveStorylineTurn` decoupled from scene-memory machinery
entirely: `StorylineTurnResult` gained a `pendingPickup?` field instead of
the function taking/mutating `sceneCard` — the route applies it onto
`session.sceneCard.pendingPickup` itself (one `if` at the same call site
that already folds `npcRelations`/`storyline` back). `bestArmor`'s AC-recompute
logic (10 + reflex + best single piece) is duplicated inline as
`bestArmorBonus` rather than importing `llm/runtimeEconomy.ts`'s version —
`shared/` must never depend on `llm/` (same reasoning as `shared/storyline.ts`'s
duplicated `npcIsGone`). `content/pack/types.ts`'s `validatePack` now imports
`catalogItem` from `@/shared/items` for the `itemId` resolution check — traced
as non-circular (`shared/items.ts`'s only pack dependency is a raw JSON import
via `content/index.ts`'s facade, never `content/pack/index.ts` or `types.ts`
itself) and confirmed with both `tsc` and a live test run.

## Explicitly OUT of scope

The season script itself and ALL authored content (3b — chapters, depth on
the live cast, real sidequests); the prologue (slice 4); overlaying
authored depth into `npcTiers`/personal jobs (trap 2 — generated wants
stay); arc lines without an active chapter; secret-reveal TRACKING (a
delivered reveal is not marked — the section keeps offering it while the
chapter runs; beat delivery already covers one-shot narrative moments);
NPC-initiated contact; seasons/end-dates.

## Definition of done — ALL MET (2026-07-18)

- ✅ `tsc` clean; full suite green (1051 baseline → **1093 final**, +42);
  golden BYTE-IDENTICAL throughout (both new sections dormant-silent).
- ✅ NO new migration (trap 3 held) — sidequest one-shot rides the jobs
  slice itself.
- ✅ Live pack: `sidequests: []`, zero authored depth — a live campaign
  behaves identically pre/post deploy (dormancy is the shipping state).
- ✅ The test stubs drive: authored-backstory overlay (Task A); a secret
  revealed only under chapter+presence, arc by act (Task B); a sidequest's
  full placement→trigger→one-shot→board-displacement loop incl. the
  expiry-then-reoffer path (Task C); a signature item granted into a FULL
  pack landing as `pendingPickup`, and a `crewUnlock` that never lowers an
  already-higher disposition (Task D).
- ✅ One commit per task (four commits); this handoff annotated per
  WORKFLOW.md Phase 2, every task's actual decisions recorded in the gaps.
- ✅ One real bug found and fixed during implementation, not in the
  original spec: the personal-job arc-resolution gate in
  `shared/jobsRuntime.ts` was too loose for a giver-is-npc job that never
  opens an arc (a sidequest) — tightened to `arcStage === "active"`, with a
  regression test.

**Phase-3 review (Fable, 2026-07-18) — one real defect found and fixed
forward, two deviations noted and accepted:**
1. **DEFECT (fixed): a signature reward parked on a scene-closing turn was
   silently lost.** `carryScene` rebuilt the scene card WITHOUT
   `pendingPickup` — and a chapter whose FINAL objective is `travel`
   completes on the arrival turn, which is ALSO a scene boundary
   (`moved` → `sceneClosed` → `carryScene`). The reward parked at
   route.ts:727, the swap chips were built from it at :806, and the
   assembly at :960 replaced the card and dropped it — the item gone AND
   the chips left pointing at nothing ("nothing to swap" on click).
   Trap 5's exact silent-loss class, arriving through the scene lifecycle
   instead of the grant path the trap named. The same hole pre-existed for
   loot parked on a scene-closing turn (rare); the travel-finale reward
   made it the NORMAL path. Fixed in `carryScene` itself
   (`pendingPickup: prev.pendingPickup` + 2 regression tests, 1095 total) —
   which also closes the pre-existing loot class; the explicit decline chip
   remains the only sanctioned way to lose a parked item. CHECKS.md §7 row
   added.
2. **Accepted deviation: a sidequest triggering onto an already-full board
   makes a 5th offer** rather than displacing a generated one (the spec's
   "displaces" only truly happens when injection precedes a top-up with
   free slots). Self-correcting within the 3-tenday expiry, and dropping a
   generated offer the player may have already been pitched would be
   weirder. Left as-is.
3. **Accepted deviation: a storyline reward's pendingPickup overwrites an
   already-parked item** (last-parked-wins) — but this is the EXISTING
   semantic of the loot path (`runtimeEconomy.ts` does the same on a new
   gain while one is parked), not new behavior. Consistent; left as-is.
Tasks A and B shipped clean — the pack-only overlay, the leak-surface
guarantees, and the reveal gating all held up under review.
