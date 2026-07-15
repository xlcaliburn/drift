# DRIFT Webapp — Technical Implementation Plan

*Companion to ARCHITECTURE.md. This file now tracks only **unbuilt** work.
Milestones M0–M8 (scaffold, schemas + DB, engine, save import, narrator loop,
play UI, durability, retrieval/tuning, multiplayer seams), structured JSON turns,
combat v1 + net-worth enemy scaling, **all item slices**, bounded-accuracy leveling,
continuity v1 + scene analyst, the procedural job board (QUESTS Phase 1), relationship
tiers (RELATIONSHIPS Phase 1), and the faction patron safety net (STARTER) are all
DONE — see CLAUDE.md for the shipped-state summary.*

Engine purity rule (still governs everything below): `engine/` takes state in,
returns new state + events out. No DB, no fetch, no randomness except through an
injected RNG (so tests can seed dice).

---

## What's left to build (rough order)

### 1. Crew v1

Recruitment + scaling upkeep per `CREW.md`. Nothing built yet — the next big slice.

### 2. Multiplayer shared-world runtime

The schemas exist (`shared/multiplayer.ts`) and universe-shared NPCs +
`log_world_event` already ship in solo play. What remains is the runtime that
turns those seams into the shared game — see **MULTIPLAYER.md** for the full
design. In brief: auto-maintained **dossiers**, relationship **ledgers**,
cross-campaign reads into the prompt, the break-away-from-faction trigger,
**seasons** with fixed end dates + a state-of-the-universe reckoning, and an
optional canon review queue (`world_events.visibility` flag already exists).

### 3. World systems — exploration / artifacts

Exploration, artifacts, and the consequence-web per **WORLD_SYSTEMS.md**.

### 4. Continuity v2

A durable **facts ledger** + the scene-analyst **playstyle/facts inference** layer
(the reasoning-model analyst infra shipped; the rolling playstyle read + relationship
deltas + facts note accumulated on the campaign remain) + the history-window shrink
(~10→6 exchanges) per **CONTINUITY.md**.

### 5. Small deferred items

- **Optimistic-lock guard on `campaign_runtime`.** `updated_at` is written but
  never checked; two concurrent turns can clobber each other. Add a compare-and-
  swap on write.
- **I-2 combat backstop.** Auto-start combat when the model narrates a fight but
  omits `combatStart`. The player-triggered half already ships (a gun-skill check
  reroutes into the combat engine); this adds the engine-side net for the model's.

---

## Decisions locked by this plan (still govern the above)

- Faction spillover = async lore via `world_events` + canon feed; no shared
  scenes, no live sync.
- Campaign mechanics never cross campaigns; only narrative events do.
- Universe owner curates canon (review queue) — protects everyone's story from a
  rogue campaign.
- `log_world_event` runs from session one so solo play seeds the shared
  universe's history.
- Engine does all math; the LLM only narrates and proposes via tools. Don't add
  prose rules for anything the engine can enforce.
