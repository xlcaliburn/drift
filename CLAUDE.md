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
- `drift/shared/schemas.ts` — Zod game state, single source of truth
- `drift/shared/multiplayer.ts` — dossier / ledger / season schemas (not yet wired —
  shared NPCs are wired via the `npcs` table, but dossiers/ledgers/seasons aren't)
- `drift/llm/{narrator,deepseek,tools,promptBuilder,engineBridge,summarizer}.ts`
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
admin panel, per-user budgets, retrieval tuning, **multi-turn combat both scales**,
bounded-accuracy leveling (compressed `skillProficiency` = `ceil(level/2)`, never
raw level in `computeModifier`), verb-driven actions, items (consumables + engine-
generated loot), **scene-memory continuity v1** + NPC registration backstops,
quest-gated relationships, **Bleeding Out death saves** (COMBAT.md — `shared/death.ts`
+ `llm/downedTurn.ts`; D&D-style 3-success/3-failure track, engine-rolled, self-
rescue with a held stim, hostile-over-you pressure, tutorial-safe), **universe-shared NPCs**
(migration 014 — generated NPCs promote to the universe `npcs` table; per-player
standing stays in `npc_relations`) + backstory NPCs at creation, the People /
Factions sidebar tabs, **net-worth enemy scaling** (COMBAT.md §1 —
`shared/netWorth.ts`, combatStart clamped to the player's threat band, spawn-count
backstop, shields T3/boss-only), and **items COMPLETE** (`ITEMS.md` — full
weapon/armor catalog with legacy-gear mapping, inventory slots 8+might, engine-owned
rotating markets (`purchase`/`sell`), deterministic out-of-combat item chips +
name-resilient consumable resolution, full-pack drop-to-take swap chips, and dock
hull repair + credit/debt payoff loop (ECONOMY E-3)).

**What's LEFT to build** (rough order; each has a design doc):

- **Crew v1** (`CREW.md`) — recruitment + scaling upkeep. Nothing built yet.
- **Shared-world runtime** (`MULTIPLAYER.md`) — dossiers, relationship ledgers,
  cross-campaign reads, break-from-faction trigger, seasons + season-end reckoning.
  (Universe-shared NPCs are the first piece and are done.)
- **World systems** (`WORLD_SYSTEMS.md`) — exploration / artifacts / consequence-web.
- **Continuity v2** (`CONTINUITY.md`) — a durable facts ledger, and the history-
  window shrink (~10→6 exchanges) after a playtest cycle.
- **Small deferred:** optimistic-lock guard on `campaign_runtime` (`updated_at` is
  written, not checked); the I-2 combat backstop (auto-START combat when the model
  narrates a fight but under-fires `combatStart` — the player-triggered gun-skill
  reroute half already ships); a summarizer bug that persisted raw truncated JSON as
  a few scene summaries.

Don't add prose rules for things the engine can enforce.

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
- `ITEMS.md` — remaining item slices (slots / ammo / shops); `CREW.md` — crew
  recruitment + scaling upkeep (unbuilt); `COMBAT.md` — the one deferred combat item
  (I-2 auto-start backstop). Build order: items → crew.
- `IMPLEMENTATION.md` — what's left to build, in rough order
- `MULTIPLAYER.md` — shared-world design (dossiers, ledgers, seasons — NPCs done)
- `WORLD_SYSTEMS.md` — exploration / artifacts / consequence-web design (unbuilt)
- `STATUS.md` — remaining-work snapshot + how to run/verify
