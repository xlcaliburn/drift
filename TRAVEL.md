# TRAVEL.md — routes, risk, and arrival (SHIPPED 2026-07-16)

*Player ask: predefined low/med/high-risk routes that actually affect encounters
(not just map flavor), a hover-to-reveal map instead of always-on lines, the tenday
clock visible while looking at travel, and a guaranteed richer beat whenever the
player reaches a new major location — engine-owned, matching the CHECKS.md "prose ↔
mechanics" discipline (risk must change what HAPPENS, not just what the map says).*

## The one invariant (same as everywhere)

The ROUTE and the INCIDENT ROLL are engine-owned; the narrator only writes the beat
around the engine's result — same contract as combat, hazards, and loot.

## Routes (`shared/routes.ts`)

Two layers, same pattern as `shared/crew.ts`'s tier tables:
- **Named lanes** — a small hand-authored set (the ones the map draws), tendays/risk
  grounded in the universe primer's own flavor text ("Rook ~3 days out", "Talos ~4
  days through the Shear").
- **Formula fallback** — every OTHER pair (Halcyon, Coldharbor, Cinderhaul, the Wake,
  and all cross-pairs) resolves from both endpoints' danger TIER + hazard/raider/
  lawless TAGS, so there's no 45-row table to hand-maintain and no pair is ever
  undefined.

`routeBetween(fromId, toId, locations)` is pure and total (same-location or unknown
ids resolve to a sane default, never throw). `riskColor`/`riskLabel` are the single
source both the map and any future surface read, so "high risk" means the same red
everywhere.

## Risk actually drives encounters

`rollTransitIncident(risk, rng)` — engine-owned, seeded, chance bands per tier (low
10% / medium 25% / high 45%, tuned in `shared/routes.ts` like every other C-1-style
constant). Rolled once per genuine arrival, inside `llm/jsonTurn.ts`'s post-`applyPlan`
pipeline (the same slot as the existing combat-open/intent re-narration passes) —
the moment `runtime.sceneEndReport.checklist.arrivalBeatOwed` fires (engine/
sceneEnd.ts's ONLY write path for `currentLocationId`, so this catches every real
arrival, model-driven `sceneEnd` or the turn-cap auto-close alike).

The roll shows as an auditable `🛰 Transit (…risk): N vs chance → INCIDENT|clear`
system line, then ONE extra model call extends the arrival beat: a genuine
ESTABLISHING PARAGRAPH for the new place, plus exactly one grounding element — a
complication on a hit (the narrator may set `danger`/`combatStart`), a routine but
concrete beat (an NPC, a rumor, a lead) on a clear roll. Every location in the
current 10-place seed is a real hub — there's no "minor site" concept yet (that's
LOCATIONS.md Phase 2's procedural sites), so any genuine station-to-station move
qualifies.

## Travel time

`engine/time.ts`'s `tendaysForSceneClose` takes an optional `routeTendays` — the
turn route computes it via `routeBetween` whenever a move is detected, so a
Meridian↔Rook hop costs what the route says (3 tendays), not a blanket "1" regardless
of distance. Falls back to the flat constant when the route isn't resolvable.

## Map UI (`components/sidebar/MapTab.tsx`)

- All 10 canonical locations now have curated positions (was 6/10 — the rest fell
  back to a generic ring).
- **No lines by default.** Hovering a location previews the route FROM wherever the
  player is currently pinned — a line colored by `riskColor`, labeled with the
  travel time — via `routeBetween`, so it works for every pair, not just the
  hand-drawn lanes.
- **Tenday readout** in the header, matching the Status tab.
- **In-transit indicator** — a second pulsing ring + a caption, derived from the
  same heuristic the Status tab already uses (`sceneCard.place` not matching the
  pinned station's name). Honest about its limit: since `currentLocationId` only
  changes at the MOMENT of arrival, there's no engine signal yet for "traveling
  toward X" — the indicator shows you're away from your last known station, not a
  destination. A real destination-aware indicator needs a dedicated travel-intent
  field; deferred.

## Known gaps

- No "minor site" tier — every location is treated as hub-worthy for the arrival
  richness pass; will need a flag once LOCATIONS.md's procedural sites land.
- In-transit has no real destination signal (see above).
- `INCIDENT_CHANCE` bands are a first guess — tune from play data.
