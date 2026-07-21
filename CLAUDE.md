# DRIFT — working notes for Claude

A shared-world, AI-narrated space-opera TTRPG webapp. This file is the fast
resume point. For depth, read the doc it points to — don't duplicate them here.

## The one invariant (never break this)

**The engine does all math; the LLM only narrates and proposes mechanics via
tool calls.** Dice, combat matrix, HP/credits/ammo, ticks, level-ups, clocks,
economy — all pure, deterministic, seeded TypeScript in `drift/engine/`. The
narrator (`drift/llm/`) writes prose and calls tools; it never computes a result.
Every roll returns a full auditable breakdown (`d20(14) +8 = 22 vs DC 15 → success`).

## Where things live (app is in `drift/`)

- `drift/engine/` — the rules engine + tests (256 vitest, no API key needed)
- `drift/content/pack/` — **the CONTENT PACK: the single authored source of world
  truth, complete** (Modularity M1, 2026-07-18): universe primer, factions
  w/ alignment+home+color, locations w/ map positions+named lanes, canonical
  cast, job flavor, service placements — PLUS mechanical catalogs (items/
  weapons/enemyTiers/shipClasses/crew/economy), name pools, the creation
  gallery (backgrounds/alignments/ambitions/patrons/starter-gear flavor), NPC
  flavor pools (quirk/appearance/voice/backstory — ⚠ order-sensitive, never
  reorder/resize), and player-facing onboarding prose (briefs/openings).
  `skills.json`/`matrix.json` (verb→skill map, damage matrix) stay global —
  RULES vocabulary, not world flavor. Rebooting the world = author a new pack
  file, swap one line in `pack/index.ts`. Every other `content/*.ts` file
  (`creation.ts`, `examples.ts`, `briefs.ts`, `openings.ts`, `index.ts`) is now
  a PURE FACADE — mechanics + re-exports only, zero literal world data.
  `pack.test.ts` validates referential integrity + per-category completeness;
  `canonLint.test.ts` FAILS CI if a canon id is hardcoded anywhere outside
  `content/pack/` (it scans loose `content/` too, not just engine/shared/llm/
  etc.) AND if `content/index.ts` grows an inline object/array literal — never
  bypass either by exempting a file; move the data into the pack instead.
  (`scripts/seedData.ts` is a thin re-export.)
- `drift/shared/schemas.ts` — Zod game state, single source of truth
- `drift/shared/multiplayer.ts` — dossier / ledger / season schemas (not yet wired —
  shared NPCs are wired via the `npcs` table, but dossiers/ledgers/seasons aren't)
- `drift/llm/{deepseek,tools,engineBridge,summarizer}.ts` (the freeform `narrator.ts`
  loop is RETIRED/deleted; `sanitizeHistory`+`trimToLastSentence` live in `llm/history.ts`)
- `drift/llm/jsonTurn.ts` — the structured-turn ORCHESTRATOR (model call + retries +
  pre-roll). Applying the plan's mechanical intents lives in `llm/applyPlan/` (an
  ordered handler registry — new mechanic = new handler file + one registry line;
  tested model-free by `applyPlan.test.ts`). Gun-skill→combat reroute in `openFight.ts`
- `drift/llm/promptBuilder.ts` — FACADE re-exporting `jsonSystem.ts` (the JSON rules
  contract), `retrieval.ts` (`retrieveEntities`), and `promptSections/` (the per-turn
  context slice — an ordered SECTIONS registry over framing/pcSheet/economy/world
  modules; a new context line = a new section export + one registry entry). Byte-
  stability pinned by `llm/contextSlice.golden.test.ts`
- `drift/lib/state.ts` — session store (in-memory cache backed by Supabase)
- `drift/lib/auth.ts` — `getAuthedUser` / `requireApprovedUser` / `requireAdmin`
- `drift/lib/{usage,pricing}.ts` — token metering + budget enforcement
- `drift/db/schema.sql` + `db/queries.ts` — Postgres schema + snake/camel mappers
- `drift/app/` — Next.js App Router UI + API routes (`/play/[id]`, `/create`, `/admin`)

## Commands (run from `drift/`)

```bash
npm test          # 256 engine/llm tests — no keys needed
npm run dev       # http://localhost:3000
npm run build     # required before a commit — but see the gotcha below
npx tsc --noEmit  # fast typecheck; never touches .next
```

Without Supabase env vars → keyless in-memory mode (no login, stub dev admin,
nothing persists). With them → Google sign-in required.

**Verifying while the dev server is running:** `npm run build` fights the running
dev server for the `.next` dir and fails with *spurious* errors (`/api/turn`,
`/_document`, page-collection) — it's not your code. Verify with `npx tsc --noEmit`
+ `npm test`; only `npm run build` after stopping the dev server. Stale `.next`
after code changes shows as phantom errors: `rm -rf .next && npm run dev` + hard
refresh. Never run two dev servers against the same `.next` dir, and don't
`rm -rf .next` while one is running.

## Current state

The app is built, playable, persistent, and multiplayer-seeded. Shipped and stable
(don't rebuild these — they're the platform the remaining work sits on): the pure
engine, character creation + signature skills, **structured JSON turns**
(`llm/jsonTurn.ts` — validated `TurnPlan`, DeepSeek json mode, validate→retry→
repair, canonical history; the freeform tool loop is RETIRED, all turns run the JSON
path, cinematic = Sonnet), Supabase persistence + durable sessions, Google auth,
admin panel, per-user budgets, retrieval tuning, **multi-turn combat both scales**
(ship-scale now the Eclipse-style **ship2 power/dice CombatSystem** — COMBAT_V2.md
Part B) + **squad orders** (order every standing crew/ally member — Part A),
bounded-accuracy leveling (compressed `skillProficiency` = `ceil(level/2)`, never
raw level in `computeModifier`), verb-driven actions, items (consumables + engine-
generated loot), **scene-memory continuity v1** + NPC registration backstops,
quest-gated relationships, **Bleeding Out death saves** (COMBAT.md — `shared/death.ts`
+ `llm/downedTurn.ts`; D&D-style 3-success/3-failure track, engine-rolled, self-
rescue with a held stim, hostile-over-you pressure, tutorial-safe) + the **self-harm
gate** (COMBAT.md — `shared/selfHarm.ts`; a typed suicide intent gets an engine
confirmation + `confirmDeath` chip, a real death, never a narrated one), **universe-shared NPCs**
(migration 014 — generated NPCs promote to the universe `npcs` table; per-player
standing stays in `npc_relations`) + backstory NPCs at creation, the People /
Factions sidebar tabs, **net-worth enemy scaling** (COMBAT.md §1 —
`shared/netWorth.ts`, combatStart clamped to the player's threat band, spawn-count
backstop, shields T3/boss-only), and **items COMPLETE** (`ITEMS.md` — full
weapon/armor catalog with legacy-gear mapping, inventory slots 8+might, engine-owned
rotating markets (`purchase`/`sell`), deterministic out-of-combat item chips +
name-resilient consumable resolution, full-pack drop-to-take swap chips, and dock
hull repair + credit/debt payoff loop (ECONOMY E-3)), and the **procedural job board
Phase 1** (`QUESTS.md` — engine-owned, playstyle-weighted "scores" assembled from
archetype parts; `shared/quests.ts` generator + tracker, `shared/jobsRuntime.ts`
turn bridge, `campaign_runtime.jobs` jsonb slice (migration 019), a Jobs rail tab
with accept/abandon, and an `activeJobs` narrator context section. The engine detects
completion from real signals — arrival / won fight / matching skill success — and
pays the reward; offloads quest STRUCTURE off DeepSeek. Phase 1b backlog in the doc).

**What's LEFT to build:** `STATUS.md` is THE single backlog (kept current at
every feature close-out — don't duplicate it here). Headline order: shared-world
runtime remainder (break-trigger, seasons, Rolodex — `MULTIPLAYER.md` §4-6),
world systems (`WORLD_SYSTEMS.md`), Locations Phase 2, Continuity v2 remainder
(history-window shrink, GATED — `CONTINUITY_HARDENING.md` Task 7), Backstory
Phase 2, plus per-feature phase backlogs (QUESTS 1b+, RELATIONSHIPS 2, CREW 1.1).

**How work gets built:** `WORKFLOW.md` — the strategy→implement→review loop
(strong model writes a decision-final `HANDOFF_*.md`, fast model implements it
task-by-task, strong model reviews the diffs against the original failure and
fixes forward). The non-negotiables, house mechanics, and the review checklist
live THERE, once — handoffs only carry what's feature-specific.

Don't add prose rules for things the engine can enforce.

## Locked decisions (don't re-litigate)

- Engine does all math; LLM only narrates + proposes via tools.
- Multiplayer = shared **narrative** canon (dossiers, ledgers, `world_events`
  spillover). NOT a strategy game — no meters/scores/planet-capturing. Mechanics
  never cross campaigns; only lore does.
- Each player = up to **3 living characters** (`MAX_CHARACTERS`, deceased free the
  slot), each in a canon faction with its OWN private async campaign in the shared
  universe, fully AI-run, seasons with fixed end dates. Switch via the play
  header's ⇄ menu; per-user budget caps span all of a player's characters.
- Cheapest-model-first: **DeepSeek default**, Haiku fallback, Sonnet for cinematic
  / combat turns. Equal footing at character creation.
- Open signup → admin approval → players see only their own campaigns → hard
  per-user budget caps protect the API keys.

## Watch-outs

- **`campaign_runtime` jsonb slices load UNPARSED** (jobs, sceneCard,
  npcRelations… — `loadCampaignRuntime` casts, never Zod-parses, so schema
  defaults never run on old rows). A NEW field on a persisted type MUST ship
  with load-time normalization in `lib/state.ts` — this exact miss would have
  crashed every live campaign once (the cast-manifest review catch).
- `profiles` / `turn_usage` have RLS enabled with **no policies** (deny-all) — by
  design; all DB access is server-side via the service key. Supabase's advisor
  flags this; it's expected, not a bug.
- Budget check is per-turn and non-locking: two concurrent turns can both pass,
  so a cap can overshoot by ~one turn. Fine at playtest scale.
- DeepSeek's multi-turn tool-calling is less disciplined than Claude's; failure
  mode is a turn that narrates without rolling. Can't corrupt state (engine is the
  only mutator); tighten the prompt if it appears.

## Git / branch reality

- Remote `github.com/xlcaliburn/drift.git`. **`main` is the trunk** and the
  GitHub default branch — branch off it, PR into it, delete feature branches
  after merge. (The old `feat/persistence-and-creation` branch was fully merged
  into `main` and retired.)
- Push works (the earlier `todomichael` vs `xlcaliburn` 403 is resolved). If it
  recurs, clear the `github.com` entry in Windows Credential Manager and re-auth.
- Commit messages via the Bash tool: use repeated `-m` flags. PowerShell
  here-strings (`@'…'@`) are not Bash syntax and leak a stray `@` into the message.

## DB & migrations

- The **Supabase MCP connector is authenticated** — run migrations directly with
  `apply_migration` (project `mgsogqnrpvoblqxkfgge`, the "drift" project — not the
  "Life Scorecard" one) and verify with `list_tables`. Don't assume it's
  unavailable from a session-start reminder; test with `list_projects` first.
- Migrations are hand-run SQL in `drift/db/migrations/` (not CLI-managed).
  `.env.local` has only the PostgREST **service key** (can't run DDL) and no direct
  Postgres connection string, so the MCP connector is the way to apply them.
- **Google OAuth is fully set up and live** — players sign in with Google; new
  accounts land pending until approved at `/admin`.

## Docs map

- `ARCHITECTURE.md` — why it's built this way (token economics, engine/narrator split)
- `CHECKS.md` — **the continuity check REGISTRY**: every backstop/guard/re-narration
  in the game, organized by the question it answers, with the live incident each was
  born from + the known gaps. Read it before adding a feature (which check families
  does it need?) or when a playtest surfaces a contradiction (which family should
  have caught it?).
- `CONTINUITY.md` — scene-memory design (scene card / summaries / NPC relations)
- `ITEMS.md` — item catalog + the status-effect/damage-type system. SHIPPED.
  `CREW.md` — recruitment (trust-tier hire chip), per-tenday wages + nonpayment
  cascade, combat participation (auto-act, medic stabilize), role passives. v1
  SHIPPED. `COMBAT.md` — the one deferred combat item (I-2 auto-start backstop).
- `TRAVEL.md` — routes between locations (named lanes + a tier/tag formula
  fallback), risk tiers that actually roll transit-incident chances (not just map
  color), route-based travel time, and the arrival-richness re-narration pass
  (an establishing paragraph + a guaranteed grounding beat on every new-location
  arrival). SHIPPED. Map UI: hover-to-reveal route lines + tenday readout.
- `QUESTS.md` — the procedural job board (Phase 1 SHIPPED: engine-owned, playstyle-
  weighted scores; `shared/quests.ts` + `shared/jobsRuntime.ts`; Jobs rail tab)
- `RELATIONSHIPS.md` — NPC depth: relationship tiers (disposition → unlocks) + the
  trusted-tier personal job (private diegetic offer, tracked execution, campaign-side
  arc resolution). Phase 1 SHIPPED (`npcTiers` section + `generatePersonalJob` +
  arc resolution in `jobsRuntime`); Phase 2 (betrayal / favor ledger / rep greetings).
- `CANON.md` — world constants direction (curated vs. procedural). Phase 1 SHIPPED
  (stopped the cross-campaign NPC bleed: seed-only load + PC-name guard). `LOCATIONS.md`
  — the Phase 2 places+loot design (tiered canonical locations, persisted procedural
  SITES with loot tables, risk/reward tiers). DESIGN, not yet built.
- `BACKSTORY.md` — making backstory an ACTIVE ingredient (context alone doesn't make
  the model use it). Phase 1 SHIPPED: the tenday-pressure backstop —
  `shared/backstoryPressure.ts` selects the PC's most significant due anchor (an NPC
  tie, ambition, or moral code) and a new `promptSections/backstoryPressure.ts`
  section forces an explicit directive once enough tendays pass in silence. Phase 2
  (arrival tie-in, NPC-initiated contact, milestone beats, structured backstory tags)
  not yet built.
- `WORKFLOW.md` — **the strategy→implement→review loop**: non-negotiables, house
  mechanics (golden test / migrations / multi-window git / Windows traps), the
  handoff template, and the phase-3 review checklist. Handoffs reference it
  instead of restating it.
- `HANDOFF_NPC_CANON.md` — the NPC canon spec, FULLY SHIPPED (2026-07-18) —
  kept as the WORKED EXAMPLE of the workflow: each task carries shipped-
  annotations describing what the implementer decided and what the closing
  review caught.
- `HANDOFF_MODULARITY_M1.md` — the content-boundary spec, FULLY SHIPPED
  (2026-07-18: catalogs/names/npcFlavor pools/creation data/openings all moved
  into the pack; facade re-exports; canonLint + pack.test.ts extended).
  First slice of the modularity roadmap — M2 lexicon → M3 voice split → M4
  runtime pack selection → M5 combat interface are next, tracked in STATUS.md.
- `STORY.md` — the authored campaign layer — a 3-act main questline as pack
  data (engine-owned triggers/beats/choice-facts), authored sidequests, rich
  cast backstories with authored reveals, and the tutorial rebuilt as an
  authored prologue. `HANDOFF_STORY_1.md` is **FULLY SHIPPED (2026-07-18)**:
  the `report` objective (QUESTS.md 1b) + the complete storyline MACHINERY —
  `content/pack/types.ts`'s `PackStoryline` schema, `shared/storyline.ts`
  (pure trigger/advance/beat engine) + `shared/storylineRuntime.ts` (payout
  bridge), migration 031 + `lib/state.ts` normalization + turn-failure
  rollback safety, route wiring (a `storyChoice` chip), the byte-identical
  `activeChapter` prompt section, the Story tab's "Season" block, and
  `STORY_AUTHORING.md` (the owner-facing format guide) — proven against a
  TEST-ONLY 2-chapter stub. **The live pack ships an empty storyline
  (dormant)** — hot-editability is the whole point: a campaign persists only
  id pointers, so content shipped later applies live, even mid-campaign, to
  every existing campaign (retrofit via state-predicate triggers, patient
  pacing via the nudge cadence). `HANDOFF_STORY_2.md` (slice 3a, the
  content machinery) is ALSO **FULLY SHIPPED (2026-07-18)**: authored cast
  depth as a PACK-ONLY live overlay (`content/pack/index.ts`'s
  `authoredCastDepth` — `seedNpcs` is a dead end, since the seed cast loads
  from the DB npcs table, and persisting `secret` would leak it to the
  client via `/api/state`; `backstory` is always-on/spoiler-safe, `secret`/
  `arc` are chapter-gated via `promptSections/castReveals.ts`), sidequests
  as a thin Job wrapper (`shared/sidequests.ts` — placed, triggered,
  one-shot for FREE via the jobs slice itself, no migration), and signature
  chapter rewards (`itemId` via the full-pack pendingPickup path,
  `crewUnlock` raising trust to recruit-eligible) riding the existing
  payout bridge. `HANDOFF_STORY_3.md` — SEASON ONE "FAULT LINE" — is ALSO
  **FULLY SHIPPED (2026-07-18)**: Fable locked the complete season spine
  (division adjusted from "Fable drafts" for Fable-budget reasons — every
  id/trigger/fact/secret/reward fixed in the handoff, Sonnet expanded only
  the prose). The Hollow Crown's founding houses filed salvage claims on
  colony ships still in transit, engineering the "accident" (the wrecked
  **Verity**) their debt empire was built on — 11 chapters
  (`content/pack/drift/storyline.ts`, ch-1..ch-8 shared spine + 3
  fact-gated finales at ch-9a/b/c), 12 placed sidequests
  (`content/pack/drift/sidequests.ts`), 6 principals with full cast depth
  + 2 with backstory only (`content/pack/drift.ts`). **This slice ENDS
  DORMANCY** — the three dormancy tests in `pack.test.ts` flip to
  structural pins, `validatePack(pack)` returns `[]` with the full season
  in, and the golden re-pinned exactly once (one new hook line, nothing
  else moved). One deliberate deferral: a single neutral opener via the
  Ledger rather than per-faction variants (no faction trigger predicate
  exists). `HANDOFF_STORY_4.md` — THE PROLOGUE — is ALSO **FULLY SHIPPED
  (2026-07-18)**, closing out STORY.md's entire roadmap (what's left is
  future SEASONS as pack content, not code): NOT a storyline chapter (no
  trigger predicate distinguishes new campaigns from veterans) — its own
  `pack.prologue` track (`content/pack/drift/prologue.ts`) + persisted
  `Campaign.prologueStage` (migration 032), engine-advanced
  (`shared/prologue.ts`) on scale-aware fight signals (a resolved fight's
  scale is snapshotted before it clears, so a personal win never
  advances the ship-fight stage or vice versa); `undefined` stage =
  legacy campaign = the OLD quest-count tutorial rule unchanged, byte-
  for-byte (`shared/tutorial.ts`'s redefinition falls back to it only
  when unset — every existing consumer inherits this with zero edits).
  The ally rides migration 030's `temporary` flag as a real
  squad-orderable character, id-derived from the campaign id itself
  (not an RNG suffix — `characters.id` is a GLOBAL primary key); it
  departs in-memory at graduation and never resurrects on a cold load
  (`db/queries.ts`'s `survivesLoad`). Storyline + authored sidequests
  pause while the prologue runs (`resolveJobsTurn` gained one field,
  `suppressSidequests`) and resume untouched at completion. Known
  accepted gap: a model that never stages the ship fight stalls that
  stage indefinitely — hot-recoverable via the admin editor, no
  auto-skip this slice.
- `HANDOFF_PLAYTEST_POLISH_1.md` — **FULLY SHIPPED (2026-07-20)**: the first
  prologue-playtest polish batch, verified against Ludo's live run — the
  interim 🎓 stage lines are gone (one house-style graduation line stays;
  `shared/prologue.ts`'s `advancePrologue` lines), a fresh-campaign-only
  opening recap that names the ally (`buildOpeningRecap`), a full-transcript
  restore on resume (`PlayClient.tsx` was truncating to 5 exchanges even
  though `/api/state` already sent the whole capped transcript — instant
  scroll-to-bottom on that initial restore, smooth for every later turn), a
  PC-first collapsible sidebar party block + a Details "Party" tab
  (`components/sidebar/StatusTab.tsx`/`PartyTab.tsx`), the patron rest chip
  gated on genuinely hurt (`needsHelp = hp < maxHp/2`, tightened twice from
  the initial "any HP loss" pass), crew aim/cover orders made real
  (`CombatState.memberMods` mirrors the PC's own aim/cover semantics one
  level down; `enemyVolley`'s crew branch reads the cover AC) + a UI default-
  staged attack order per standing member each round, and a "Story so far"
  modal (`/api/summary`: the free, already-persisted scene-summary list via
  `loadRecentScenes`, plus an optional player-initiated cheap-model retelling
  — `llm/summarizer.ts`'s `retellStory`, metered like an appeal).
- `COMBAT_V2.md` — **DESIGN (owner priority, decisions RESOLVED), Parts A+B
  core + customization all SHIPPED (2026-07-18)**: squad control (order every
  party member, temporary allies — Part A) + Eclipse-style ship combat (power
  allocation, dice-profile mounts, shields/evasion/armor counterplay,
  escalating heat — Part B's core) + ship customization (slots, an
  outfitting catalog, buy-install/strip-sell through the market machinery).
  Charge banking/called shots (Part B's last slice) still design-only.
  `HANDOFF_COMBAT_V2_1.md`, `HANDOFF_COMBAT_V2_2.md`, and
  `HANDOFF_COMBAT_V2_3.md` are all **FULLY SHIPPED**: the lexicon seed, the
  M5 CombatSystem seam (extraction, not speculation — now proven by a REAL
  second system), squad orders (attack a chosen target / self-heal per crew
  member; un-ordered members auto-act), ship2 (power allocation + all four
  dice-profile mounts, simultaneous-reveal rounds, pack-catalog statlines, an
  allocation panel + preset chips, mount-instance keys so a ship carrying two
  of the same mount fires both), and outfitting (mount/system items, tier
  gating, slot accounting, stock-loadout materialization — all writing
  EXISTING `Ship` columns, no schema change anywhere across all three
  handoffs). `startShipCombat` now always produces a ship2 fight; the old d20
  ship engine survives only for a fight already mid-flight at deploy.
- `MULTIPLAYER.md` — shared-world design (dossiers, ledgers, seasons — NPCs done)
- `WORLD_SYSTEMS.md` — exploration / artifacts / consequence-web design (unbuilt)
- `STATUS.md` — **THE single backlog** (what's left, in order, updated at every
  feature close-out) + how to run/verify. `IMPLEMENTATION.md` is a retired stub
  pointing here.

## Multi-window coordination

Multiple Claude windows may work this repo + the shared Supabase DB at once. These
rules keep them from clobbering each other. They are not optional.

- **Single writer at a time.** Only ONE window commits/pushes or writes to the DB
  (migrations, `apply_migration`, data changes) at a given moment. Other windows
  stay read-only (analysis, reads, `list_*`/`execute_sql` SELECTs). Parallel reads
  are always fine; concurrent writes are not.
- **Sync immediately before you commit, and again right before you push:**
  `git fetch && git pull --rebase origin/main`. A parallel window may have moved
  `main` since you last looked.
- **Never trust in-memory repo/DB state across a gap.** After any pause, or if
  another window may have acted, re-read and reconcile from ground truth (git +
  `list_migrations` + `execute_sql`) before changing anything. Your recollection
  of HEAD, file contents, or applied migrations may be stale.
- **Migrations — reconcile before you number, create, or apply.** Compare the repo
  files in `drift/db/migrations/` against the LIVE applied-migration log (Supabase
  MCP `list_migrations` on drift / `mgsogqnrpvoblqxkfgge`) first. Pick the number
  with the helper (below) — never hand-pick from memory. Keep the sequential
  zero-padded `NN_name.sql` convention; do **not** switch to timestamp prefixes.
- **Next-migration helper** (`drift/scripts/next-migration.mjs`, from `drift/`):
  - `node scripts/next-migration.mjs` → prints the next number (e.g. `017`).
  - `node scripts/next-migration.mjs shared_ledger` → also scaffolds
    `db/migrations/017_shared_ledger.sql`.
  It only sees repo files, so still reconcile against `list_migrations` before
  applying (it prints that reminder).
- **Pre-push hook (hard stop).** `.githooks/pre-push` fetches and BLOCKS the push
  if your branch is behind `origin/main` (offline → warns and allows). Enable it
  ONCE per clone/worktree (hooks aren't shared automatically):

  ```bash
  git config core.hooksPath .githooks
  ```

  If a push is blocked, run `git pull --rebase origin main` and retry.
