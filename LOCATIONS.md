# LOCATIONS.md — canonical places, tiered sites & loot tables

*DESIGN (2026-07-16) — the world-constants build for places + loot, the second half
of CANON.md's Phase 2. Reaction to Angela/Wren's "it makes up places and people and
forgets them" + "I don't want crates and data cores spawning out of nowhere." The
answer: a fixed CANON of returnable locations, and engine-generated TIERED SITES with
LOOT TABLES for quests/encounters — so what you find and fight is engine-owned, not
narrator-conjured. Mirrors the net-worth enemy scaling and the item catalog.*

## The one invariant (same as everywhere)

The engine owns WHERE the returnable world is and WHAT it yields. The narrator flavors
a scene inside an engine-defined place and can't conjure a new station or a "data core"
— loot comes from a tier×archetype table the engine rolls, the same discipline that
already drops illegitimate `items:[]` gains.

## Locked decisions

- **Two kinds of location.** CANONICAL locations are the fixed, hand-authored,
  returnable places (Meridian Ring, Rook, the Nest, the Shear). Procedural SITES are
  generated quest/encounter locations (a wreck, a lab, a lockup, a stash, an
  anchorage) with a tier + a loot table + an enemy profile.
- **Tiers T1/T2/T3**, the same language as enemies and the item catalog. A site's tier
  drives enemy strength, loot quality, and hazard/investigation DCs.
- **Risk/reward — sites can EXCEED the player's band.** (AskUserQuestion-locked.)
  Unlike the net-worth *enemy* clamp, a site keeps its OWN tier: a T3 wreck in the
  Shear stays T3, and the player may KNOWINGLY venture above their weight for a bigger
  score at real risk of dying. The board/map signals the danger tier up front, so it's
  an informed choice — the clamp that protects rookies from *ambush* is deliberately
  lifted for a site they chose to enter.
- **Sites are PERSISTED**, a campaign slice on `campaign_runtime.sites` (jsonb, like
  `jobs`) — so return visits work and "already looted" state sticks. (AskUserQuestion-
  locked.) New migration.
- **Loot tables are authored CONSTANTS**, keyed by tier × archetype (a wreck yields
  salvage/parts; a lab yields data/chems; an armory yields weapons). The engine rolls
  the table; the player never names their prize (extends `engine/loot.ts`).
- **Canon is fixed; sites hang off it.** The narrator never mints a new canonical
  station. A site has a `parentLocationId` (or "the black") and is engine-generated.

## Data model

**Canonical `Location` — add a tier** (`shared/schemas.ts`):
```
Location { id, universeId, name, description?, tags, tier?: "T1"|"T2"|"T3" }
```
`tier` defaults from tags when unset: `home/commerce/crown` → T1, `lawless/contested/
blackmarket` → T2, `hostile/hazard/raiders/shear` → T3. Hand-set on the seed cast.

**`Site` — new, persisted** (`shared/sites.ts`, pure):
```
Site {
  id, name,
  archetype: "wreck"|"derelict"|"lab"|"lockup"|"cache"|"anchorage"|"outpost",
  tier: "T1"|"T2"|"T3",
  parentLocationId?: string,     // canonical location it hangs off; undefined = the black
  lootTableId: string,           // `${archetype}-${tier}`
  enemyTier?: "T1"|"T2"|"T3",    // encounter strength (defaults to the site tier)
  status: "known"|"reached"|"cleared",
  looted: boolean,               // loot-taken — a return visit is picked clean
  jobId?: string,                // the job that spawned it, if any
  createdTenday: number,
}
```

**`LootTable` — content constants** (`content/lootTables.json`), keyed `${archetype}-${tier}`:
```
"wreck-T1": { credits: [20, 60], common: ["scrap"], useful: ["charge pack","data shard"],
              rare: [] },
"lab-T2":   { credits: [120, 260], common: ["chem vial"], useful: ["stim","data core"],
              rare: ["combat stim"] },
"armory-T3":{ credits: [300, 600], common: ["spent mag"], useful: ["ammo mag"],
              rare: ["<catalog weapon id>"] }
```
Each entry: a credits band + weighted `common`/`useful`/`rare` pools (catalog item ids
for mechanical drops, flavor strings for scrap). The engine rolls credits + one common,
and on a clean clear/crit reaches `useful`, rarely `rare`.

## How it wires into what exists

- **QUESTS** (`shared/quests.ts`) — `salvage` / `recon` / `heist` / `bounty` archetypes
  generate a **Site** as their destination instead of only a flavor blurb; the
  `travel`/`deliver`/`investigate` objective points at the site. Completing/looting it
  rolls the site's loot table (replacing the flavor-only `CARGO` pool). A high-tier
  site can back a job the player took knowing it's above their band.
- **COMBAT** — a site's `enemyTier` drives `combatStart`; for a KNOWINGLY-entered site
  the net-worth clamp is overridden by the site tier (the risk/reward call). The
  existing spawn/roster machinery is unchanged.
- **ITEMS** (ITEMS.md) — every drop is a catalog id or a defined flavor string; no
  narrator-conjured cargo. `rollSiteLoot` supersedes the flat `generateScavengeLoot`
  band when looting a site; an ad-hoc scavenge elsewhere keeps the current default.
- **Narrator** (`llm/jsonSystem.ts` + a promptSection) — `place` flavors a scene inside
  a canonical location or an active site; travel destinations are canonical locations
  or engine sites; a new rule forbids inventing stations or narrating found loot the
  engine didn't grant.

## Where it will live

- `shared/schemas.ts` — `Location.tier`.
- `shared/sites.ts` — `Site` schema, `ARCHETYPES`, `generateSite(...)`, `rollSiteLoot(...)`; pure + unit-tested.
- `content/lootTables.json` + `content/index.ts` export — the loot constants.
- `engine/loot.ts` — refactor to read a table when one is given; keep the flat default.
- `db/migrations/NNN_runtime_sites.sql` — `campaign_runtime.sites jsonb default '[]'`.
- `db/queries.ts` + `lib/state.ts` — persist the `sites` slice (mirror `jobs`).
- `shared/quests.ts` / `shared/jobsRuntime.ts` — spawn a site for site-archetype jobs; roll loot on completion.
- `app/api/turn/route.ts` — thread the sites slice + loot resolution (out of the refactor zone, like jobs).
- `components/sidebar/` — a **Map/Sites** surface: canonical locations with their tier + known sites with ⚠ danger tiers.
- `llm/promptSections/` — a `world`/`sites` section feeding the current location tier + reachable sites.

## Phasing

- **Phase 2a — Canonical location tiers + narrator discipline.** `Location.tier`
  (default from tags, hand-set on the seed cast), feed the current location's danger
  tier to the prompt, and the "no invented stations; `place` is flavor within canon"
  rule. Directly answers "makes up places and forgets them." Smallest slice, no
  migration.
- **Phase 2b — Loot tables.** `content/lootTables.json` (tier × archetype) +
  `rollSiteLoot`; route scavenge/loot through tables. Answers "crates/data cores from
  nowhere." No migration (content + engine only).
- **Phase 2c — Procedural sites.** `shared/sites.ts` + the `sites` campaign slice
  (migration) + generation wired into QUESTS (site-archetype jobs spawn a site) and
  COMBAT (site `enemyTier`, clamp override) + the Map/Sites UI with danger tiers. The
  risk/reward heart.

## Open questions (resolve during the build)

- **Discovery** — how a site becomes `known`: job-spawned + an NPC rumor to start; an
  explicit explore/scan action later (ties into WORLD_SYSTEMS.md exploration).
- **Sub-locations of canon** — a canonical station's back-alley as a mini-site: later.
- **Seed authoring** — the universe needs tier assignments (2a) + a starter loot-table
  set spanning the archetypes × T1-T3 (2b); a small hand-authored content pass.
- **Admin curation** — surfacing sites + location tiers in the campaign editor for
  hand-tending, alongside the CANON.md NPC-seed curation.
