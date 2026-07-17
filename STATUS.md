# DRIFT — Status & Resume Notes

*THE single "what's left" list + how to run. Kept current at every feature
close-out (WORKFLOW.md Phase 3). For the "why", see `ARCHITECTURE.md`; for fast
orientation, `CLAUDE.md` (its docs map carries per-doc status). IMPLEMENTATION.md
is retired into this file.*

The app is built, playable, persistent, and multiplayer-seeded. Shipped: the pure
engine, character creation (+ signature skills, story prompt), structured JSON
narrator turns, Supabase persistence + durable sessions + optimistic concurrency,
Google auth, admin panel + **admin campaign editor**, per-user budgets, multi-turn
combat both scales + net-worth scaling, bounded-accuracy leveling, verb actions,
items COMPLETE (catalog/slots/shops/cargo/dock repair+debt), scene-memory
continuity v1 + the scene analyst + the **facts ledger** (grounding/pinning/
correction loop), travel (routes/risk/arrival richness + engine-owned location
backstop), **crew v1**, quests Phase 1 + diegetic offers + **cast manifests**,
relationship tiers + personal jobs, Bleeding Out + self-harm gate, universe-shared
NPCs + **NPC canon pins** (home/role/quirk/backstory/appearance/sex/tier/faction/
voice/age, fate recording, name-collision + companion + presence guards — see
CHECKS.md §2), the faction patron, backstory pressure, and the player directive.

## How to run / verify

```bash
cd drift
npm install
cp .env.example .env.local     # DEEPSEEK_API_KEY (cheapest) or ANTHROPIC_API_KEY; + Supabase vars for auth
npm run dev                    # http://localhost:3000
npx tsc --noEmit               # fast typecheck (never touches .next)
npx vitest run                 # ~834 model-free tests, no keys needed
```

- **Keyless mode** (no Supabase vars): no login, stub dev admin, nothing persists.
- **Don't `npm run build` while the dev server runs** (they fight over `.next`).
- Migrations: hand-run SQL in `drift/db/migrations/`, applied via the Supabase MCP
  (`apply_migration`, project `mgsogqnrpvoblqxkfgge`). Reconcile numbering against
  `list_migrations` first — see WORKFLOW.md.

## What's left to build (rough order)

1. **Shared-world runtime** (`MULTIPLAYER.md`): dossiers (§1), cross-campaign
   reads (§3), and the relationship ledger (§2) are SHIPPED. LEFT: the
   break-away-from-faction trigger (§4), seasons with fixed end dates + the
   season-end reckoning (§5), a Rolodex UI, and the optional canon review queue
   (§6 — `world_events.visibility` already exists).
2. **World systems** (`WORLD_SYSTEMS.md`): exploration / artifacts /
   consequence-web. Unbuilt.
3. **Locations Phase 2** (`LOCATIONS.md`): tiered canonical places + persisted
   procedural SITES with loot tables. Design only.
4. **Continuity v2 remainder** (`CONTINUITY.md` + `CONTINUITY_HARDENING.md`):
   the history-window shrink (Task 7) — GATED on ~1 week of healthy production
   summary telemetry; the analyst's rolling playstyle read + relationship deltas.
5. **Backstory Phase 2** (`BACKSTORY.md`): arrival tie-in, NPC-initiated contact,
   milestone beats, structured backstory tags.

## Feature-doc phase backlogs (next phases of shipped features)

- **Quests Phase 1b+** (`QUESTS.md`): model-signalled "report back" steps,
  NPC-given jobs (`giver` = npc id), faction arcs, the incidental-NPC reusable
  pool, board top-up tuning. (Cargo + cast manifests SHIPPED.)
- **Relationships Phase 2** (`RELATIONSHIPS.md`): betrayable secrets, favor
  ledger, reputation-aware greetings, hostility escalation.
- **Crew v1.1** (`CREW.md`): crew statuses/resists, downed-crew rules, mutiny,
  ship-scale crew actions.

## Small deferred items

- **I-2 combat backstop** (`COMBAT.md`): auto-START combat when the model
  narrates a fight but under-fires `combatStart` (the player-triggered gun-skill
  reroute half already ships).
- Allegiance CHANGES as story events (the faction pin is set-once; a defection
  needs its own beat — consequence-web territory).
- ECONOMY E-4/E-5/E-6 (`ECONOMY.md`): gated on trade/cargo-capacity work.
- Job-cast members lost-on-death cleanup nuance (QUESTS.md).

## Watch-outs

Live in `CLAUDE.md` (single copy — RLS deny-all is deliberate, budget check is
non-locking, DeepSeek under-fire failure mode, warm-cache vs direct DB writes,
jsonb slices load unparsed).
