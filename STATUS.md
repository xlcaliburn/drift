# DRIFT — Status & Resume Notes

*What's left to build + how to run. For the "why", see `ARCHITECTURE.md`; for the
fast orientation, `CLAUDE.md`.*

The app is built, playable, persistent, and multiplayer-seeded. Everything through
the core platform is shipped (engine, character creation, structured JSON narrator
turns, Supabase persistence + durable sessions, Google auth, admin panel, per-user
budgets, retrieval tuning, multi-turn combat both scales, bounded-accuracy leveling,
verb actions, items consumables + engine loot, scene-memory continuity v1 + NPC
backstops, quest-gated relationships, bleed-out limit, universe-shared NPCs +
backstory NPCs, People/Factions UI). This file tracks only what remains.

## How to run / verify

```bash
cd drift
npm install
cp .env.example .env.local     # DEEPSEEK_API_KEY (cheapest) or ANTHROPIC_API_KEY; + Supabase vars for auth
npm run dev                    # http://localhost:3000
npx tsc --noEmit               # fast typecheck (never touches .next)
npm test                       # 256 engine/llm tests, no keys needed
```

- **Keyless mode** (no Supabase vars): no login, stub dev admin, nothing persists.
  With the vars, Google sign-in is required.
- **Don't `npm run build` while the dev server runs** — they fight over `.next` and
  it fails with spurious errors. Verify with `tsc --noEmit` + `npm test`; only build
  after stopping the server. Stale `.next` → `rm -rf .next && npm run dev` + hard
  refresh. Never run two dev servers against the same `.next`.
- Supabase MCP connector is authenticated — run migrations with `apply_migration`
  (project `mgsogqnrpvoblqxkfgge`, the "drift" project). Migrations are hand-run SQL
  in `drift/db/migrations/`.

## What's left to build (rough order)

1. **Items v1 — slices B / D / E** (`ITEMS.md`): inventory slots, ammo spend, shops.
   (Slice A consumables + slice C loot are shipped.)
2. **Crew v1** (`CREW.md`): recruitment + scaling upkeep. Nothing built yet.
3. **Shared-world runtime** (`MULTIPLAYER.md`): dossiers (derive capability tier from
   stats, append deeds from `world_events`), relationship ledgers (who-knows-what),
   cross-campaign reads (pull another player's dossier + your ledger into the prompt
   so characters can meet, GM plays them gated by ledger knowledge), break-away-from-
   faction trigger, seasons with fixed end dates + a season-end "state of the
   universe" reckoning, optional canon review queue (`world_events.visibility` exists).
   Universe-shared NPCs are the first piece and are done (migration 014).
4. **World systems** (`WORLD_SYSTEMS.md`): exploration / artifacts / consequence-web.
5. **Continuity v2** (`CONTINUITY.md`): a durable facts ledger; history-window shrink
   (~10→6 exchanges) after a playtest cycle.

## Small deferred items

- Optimistic-lock guard on `campaign_runtime` (`updated_at` is written but not checked).
- I-2 combat backstop: auto-START combat when the model narrates a fight but doesn't
  emit `combatStart` (the player-triggered gun-skill reroute half already ships).
- Summarizer bug: a few scene summaries persisted raw truncated JSON (`{\n "summary":
  "…`) instead of clean text — an output-parsing bug to fix.

## Design decisions locked (don't re-litigate)

- Engine does all math; the LLM only narrates + proposes via tools.
- Multiplayer = shared **narrative** world, NOT a strategy game. No meters/scores/
  planet-capturing. Mechanics never cross campaigns; only lore does.
- Each player = one character in a canon faction, own private async campaign in a
  shared universe, fully AI-run, seasons with a fixed end date. Cross-player contact
  via dossiers + ledgers.
- Cheapest-model-first: DeepSeek default, Sonnet for cinematic/combat. Equal footing
  at character creation.
- Open signup → admin approval → players see only their own campaigns → hard per-user
  budget caps protect the API keys.

## Watch-outs

- `profiles` / `turn_usage` have RLS enabled with **no policies** (deny-all) — by
  design; all DB access is server-side via the service key. Supabase's advisor flags
  it; expected, not a bug.
- Budget check is per-turn and non-locking: two concurrent turns can both pass, so a
  cap can overshoot by ~one turn. Fine at playtest scale.
- DeepSeek's discipline is weaker than Claude's; the failure mode is a turn that
  narrates without rolling. It can't corrupt state (the engine is the only mutator) —
  tighten the prompt if it appears.
- The in-memory session cache in `lib/state.ts` is the per-turn fast path; the
  `campaign_runtime` snapshot is the durable source. A running dev server can
  re-persist stale in-memory NPCs after a direct DB cleanup — restart to cold-load.
