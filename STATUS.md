# DRIFT — Status & Resume Notes

*What's left to build + how to run. For the "why", see `ARCHITECTURE.md`; for the
fast orientation, `CLAUDE.md`.*

The app is built, playable, persistent, and multiplayer-seeded. Everything through
the core platform is shipped (engine, character creation, structured JSON narrator
turns, Supabase persistence + durable sessions, Google auth, admin panel + campaign
editor, per-user budgets, retrieval tuning, multi-turn combat both scales +
**net-worth enemy scaling**, bounded-accuracy leveling, verb actions, **items
COMPLETE** (catalog, slots, ammo, shops, swap chips, dock repair/debt), scene-memory
continuity v1 + the reasoning-model **scene analyst**, quest-gated relationships +
**relationship tiers/personal jobs** (RELATIONSHIPS Phase 1), Bleeding Out death
saves, universe-shared NPCs + backstory NPCs, People/Factions UI, the player
**directive**, the **faction patron / early-game safety net** (STARTER), and the
**procedural job board Phase 1** (QUESTS)). This file tracks only what remains.

## How to run / verify

```bash
cd drift
npm install
cp .env.example .env.local     # DEEPSEEK_API_KEY (cheapest) or ANTHROPIC_API_KEY; + Supabase vars for auth
npm run dev                    # http://localhost:3000
npx tsc --noEmit               # fast typecheck (never touches .next)
npm test                       # ~525 engine/llm tests, no keys needed
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

1. **Crew v1** (`CREW.md`): recruitment + scaling upkeep. Nothing built yet.
2. **Shared-world runtime** (`MULTIPLAYER.md`): dossiers (§1), cross-campaign reads
   (§3), and the **relationship ledger** (§2 — gates cross-player cameos to what the
   character knows, `shared/ledger.ts`, migration 020) are SHIPPED. LEFT: the
   break-away-from-faction trigger (§4), seasons with fixed end dates + a season-end
   "state of the universe" reckoning (§5), a Rolodex UI, and the optional canon
   review queue (§6, `world_events.visibility` already exists).
3. **World systems** (`WORLD_SYSTEMS.md`): exploration / artifacts / consequence-web.
4. **Continuity v2** (`CONTINUITY.md`): a durable **facts ledger**; the scene-analyst
   **playstyle/facts inference** layer (analyst infra shipped; the rolling playstyle
   read + relationship deltas + facts note accumulated on the campaign remains);
   history-window shrink (~10→6 exchanges) after a playtest cycle.

## Feature-doc phase backlogs (next phases of shipped features)

- **Quests Phase 1b+** (`QUESTS.md`): model-signalled "report back" steps,
  inventory-tracked cargo, NPC-given jobs, faction arcs, board top-up tuning.
- **Relationships Phase 2** (`RELATIONSHIPS.md`): betrayable secrets, favor ledger,
  reputation-aware greetings, ally-tier mechanics, hostility escalation.

## Small deferred items

- Optimistic-lock guard on `campaign_runtime` (`updated_at` is written but not checked).
- I-2 combat backstop (`COMBAT.md` §4): auto-START combat when the model narrates a
  fight but doesn't emit `combatStart` (the player-triggered gun-skill reroute half
  already ships).
- Summarizer bug: a few scene summaries persisted raw truncated JSON (`{\n "summary":
  "…`) instead of clean text — an output-parsing bug to fix.
- ECONOMY E-4/E-5/E-6 (`ECONOMY.md`): retire per-job wage once crew upkeep lands,
  cargo-capacity rules, a payout variance floor — all gated on unbuilt crew/trade.

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
