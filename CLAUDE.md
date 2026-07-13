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
npm test          # 64 engine tests — no keys needed
npm run dev       # http://localhost:3000
npm run build     # REQUIRED before any commit
```

Without Supabase env vars → keyless in-memory mode (no login, stub dev admin,
nothing persists). With them → Google sign-in required. Stale `.next` after code
changes shows up as phantom errors: `rm -rf .next && npm run dev` + hard refresh.
Never run two dev servers against the same `.next` dir.

## Current state

M0–M6 done: engine, character creation + unique skills, narrator tool-loop, play
UI, Supabase persistence, Google auth, admin panel, per-user monthly budgets
(default 2M tokens / $5). Full milestone table + resume detail: **`STATUS.md`**.

**Next up — M7, durable transcripts.** Mechanical state (HP, credits, clocks,
threads) persists, but the **chat transcript + dice log still live only in
memory** — a server restart loses narrative scrollback (not mechanical state).
Persist scenes/turns/rolls; add an `updated_at` version check to avoid
last-write-wins on concurrent turns.

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
- Push may 403: this machine's cached credential is for account `todomichael`,
  not `xlcaliburn`. Fix via Windows Credential Manager (remove the `github.com`
  entry, re-auth), or add `todomichael` as a collaborator.

## External setup that only the user can do (not code)

- **Google OAuth**: DB migration is applied. Still need the Google Cloud OAuth
  client + enable Google in Supabase + add `http://localhost:3000/auth/callback`
  redirect, then sign in once (trigger grants admin+approved) and claim the 3
  seeded campaigns (`player_id is null`). Steps in `STATUS.md` → Open action items.

## Docs map

- `ARCHITECTURE.md` — why it's built this way (token economics, engine/narrator split)
- `IMPLEMENTATION.md` — milestone-by-milestone build plan
- `MULTIPLAYER.md` — shared-world season design (factions, dossiers, ledgers)
- `WORLD_SYSTEMS.md` — exploration / artifacts / consequence-web design
- `STATUS.md` — the detailed resume snapshot (read this first when picking work back up)
