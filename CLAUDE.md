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

- `drift/engine/` — the rules engine + tests (64 vitest, no API key needed)
- `drift/shared/schemas.ts` — Zod game state, single source of truth
- `drift/shared/multiplayer.ts` — dossier / ledger / season schemas (not yet wired)
- `drift/llm/{narrator,deepseek,tools,promptBuilder,engineBridge,summarizer}.ts`
- `drift/lib/state.ts` — session store (in-memory cache backed by Supabase)
- `drift/lib/auth.ts` — `getAuthedUser` / `requireApprovedUser` / `requireAdmin`
- `drift/lib/{usage,pricing}.ts` — token metering + budget enforcement
- `drift/db/schema.sql` + `db/queries.ts` — Postgres schema + snake/camel mappers
- `drift/app/` — Next.js App Router UI + API routes (`/play/[id]`, `/create`, `/admin`)

## Commands (run from `drift/`)

```bash
npm test          # 75 engine/llm tests — no keys needed
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

M0–M7 done: engine, character creation + unique skills, narrator tool-loop, play
UI, Supabase persistence, Google auth (OAuth live), admin panel, per-user monthly
budgets (default 2M tokens / $5), and **durable play sessions** — transcript, dice
log, and narrator history persist to `campaign_runtime` and restore on cold load
(migration 006). Full milestone table + resume detail: **`STATUS.md`**.

**M8 retrieval tuning done:** `promptBuilder.retrieveEntities` now scores NPCs
(focus > named > location-present > faction) and threads (entityRefs > title
overlap > objective floor), capped and tested; `focusIds` carries entities the
player *named* into the next turn for short-term continuity (no self-pin).

**Structured JSON turns (cheap-model discipline):** routine turns run
`llm/jsonTurn.ts` — the model returns a validated `TurnPlan`
(`shared/turnPlan.ts`: narration + choices [+ attached checks] + roll/worldEvent/
sceneEnd), DeepSeek json_object mode, validator → one retry → repair. A clicked
choice's check is **pre-rolled by the engine** (dice shown as 🎲 system lines,
tick awarded immediately — `campaign_runtime.ticked_this_scene` holds the
per-scene cap). History is CANONICAL (action + `[ENGINE: …]` summary / cleaned
narration only — never raw model output; prevents few-shot contamination).
Narration still streams via `llm/jsonStream.ts`. Combat set-pieces keep the tool
loop in `narrator.ts`. Don't add prose rules for things the engine can enforce.

**Combat v1 done (both scales):** engine-owned multi-turn combat — a fight is a
persisted `CombatState` (`campaign_runtime.combat`, migration 009), one player
turn = one round (engine-generated action chips → player action → enemy volley →
end check), damage through `applyDamage` (downed→dead) / `applyShipDamage`
(hull-0 = disabled, not death). Personal + ship (burst-drive flee, interaction
matrix). Model only emits `combatStart` + narrates; it can't skip mechanics. The
freeform tool loop is RETIRED — all turns run the JSON path (cinematic = Sonnet).
Engine-clamped money (`award_payout` bands), immediate skill ticks, real-stakes
damage/death all landed alongside. Money/repair: `content/economy.json`.

**Bounded-accuracy leveling + gun-skill reroute:** skill levels run 0–10 (cap in
`progression.MAX_SKILL_LEVEL`; tick cost stays quadratic) but the d20 bonus is a
*compressed* `skillProficiency(level)` = `ceil(level/2)` → +0…+5, NOT raw level —
so a maxed specialist reliably clears routine DCs without swamping the die, and
combat hit-rolls (same modifier) stay tense. Don't reintroduce raw `level` into
`computeModifier`. And a `smallArms`/`gunnery` **check is auto-rerouted into the
combat engine** (`jsonTurn.openFightFromSkill`): it spawns the target and resolves
an opening shot (roll-to-hit → damage), then flows into multi-turn combat — gun
skills never resolve as a self-only `roll_check`. This is the player-triggered
half of the I-2 backstop.

**Scene memory / continuity v1 done (`CONTINUITY.md`):** the scene is the unit of
memory. Engine-owned **SceneCard** (seq/turnCount/presentNpcIds + model-proposed
situation/beats, capped) rides every prompt as SCENE NOW; present NPCs are forced
into retrieval all scene. **NPC relations** (`campaign_runtime.npc_relations`,
migration 012) — relationship (set-once) + disposition (engine-clamped −3..+3,
model nudges ±1/NPC/turn, visible "👤 Doyle: warm → trusted" lines) + rolling
lastNote — render on NPC context lines and in the sidebar Contacts section.
**Scene summaries**: sceneEnd (or the auto-close backstop at 12 turns) triggers a
background `summarizeScene` → `scenes` table → PREVIOUSLY block (last 3 + up to 2
entity-matched older scenes). Deferred: facts ledger (v2), history 10→6 shrink
(D-3, one playtest cycle after summaries prove out).

**Next up (build order, docs are ready):** items v1 slices B–E (`ITEMS.md` —
slots + loot + ammo spend + shops; slice A consumables SHIPPED) → **crew v1**
(`CREW.md`). Then the shared-world runtime / `WORLD_SYSTEMS.md` artifact slice.
Small deferred: optimistic-lock guard on `campaign_runtime`, the I-2 combat
backstop (auto-start combat if the model under-fires `combatStart`).

## Locked decisions (don't re-litigate)

- Engine does all math; LLM only narrates + proposes via tools.
- Multiplayer = shared **narrative** canon (dossiers, ledgers, `world_events`
  spillover). NOT a strategy game — no meters/scores/planet-capturing. Mechanics
  never cross campaigns; only lore does.
- Each player = one character in a canon faction, own private async campaign in a
  shared universe, fully AI-run, seasons with fixed end dates.
- Cheapest-model-first: **DeepSeek default**, Haiku fallback, Sonnet for cinematic
  / combat turns. Equal footing at character creation.
- Open signup → admin approval → players see only their own campaigns → hard
  per-user budget caps protect the API keys.

## Watch-outs

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
- `CONTINUITY.md` — scene-memory design (scene card / summaries / NPC relations)
- `COMBAT.md` / `CREW.md` / `ITEMS.md` — build-ready designs: multi-turn combat
  (both scales, escape-by-disparity, tool-loop retirement), crew recruitment +
  scaling upkeep, item catalog + consumables + inventory slots. Build order:
  combat → items → crew.
- `IMPLEMENTATION.md` — milestone-by-milestone build plan
- `MULTIPLAYER.md` — shared-world season design (factions, dossiers, ledgers)
- `WORLD_SYSTEMS.md` — exploration / artifacts / consequence-web design
- `STATUS.md` — the detailed resume snapshot (read this first when picking work back up)
