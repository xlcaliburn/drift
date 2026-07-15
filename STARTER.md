# STARTER.md — early-game safety net + starter quests

Fixes the early death-spiral (bad rolls → no money/stims → stuck). Two parts: a
per-faction **patron** who keeps a struggling rookie afloat, and **playstyle-tagged
starter jobs** so there's always an obvious, paying next move.

## Locked decisions (2026-07-15)

- **Helper = a per-FACTION patron NPC at the start location.** Seeded per campaign
  (`npc-patron-<campaignId>`) at the faction's home location, faction-flavored
  (`FACTION_PATRON`). Created at character creation; backfilled for existing games.
- **Free safety net turns off at net worth ¢600** — the T1→T2 band edge
  (`PATRON_HELP_MAX`, from `shared/netWorth`). Below it you're a struggling rookie;
  at/above it you've found your feet.
- **The net gives ALL of:** rest to full HP + hull, refill stims (to a floor),
  a small credit stipend when broke, free ship repair. One engine action
  (`restWithPatron`) does the lot, gated to `netWorth < 600` AND the patron being
  PRESENT in the current scene (station-level location match is NOT enough — see
  the 2026-07-15 fix below).
- **Starter quests = a playstyle-tagged job menu.** The patron offers a few short,
  winnable, guaranteed-paying starter jobs tagged trade / fight / explore / social,
  matched to the player's `directive`/lean. Prompt-driven (the narrator fleshes them
  out; the engine tracks the thread + pays the tier), not fully authored per beat.

## Pieces — SHIPPED (2026-07-15)

1. ✅ `content/creation.ts` — `FACTION_PATRON` (name/role/oneBreath per faction) +
   `FACTION_HOME` (start location per faction) + `patronFor(factionId)`.
2. ✅ `engine/creation.ts` — `buildPatronNpc({campaignId, universeId, factionId})` →
   the patron `Npc` at the faction home + its seeded `NpcRelation` (disposition +1,
   "your patron"). Seeded by the create route; `ensurePatronSeed(state)` is the
   load-time backstop that reaches legacy campaigns (mirrors `ensureStartingGun`).
3. ✅ `engineBridge` — `restWithPatron()`: eligibility via `patronHelp` (netWorth <
   ¢600 AND patron PRESENT in the scene) → HP + hull to full, clears Downed +
   death-saves, stims to a floor of 2, ¢120 stipend when broke (< ¢40); returns a
   🛟 line. `patronHelp(state, presentNpcIds)` in `shared/netWorth` backs the chip
   + prompt (single source of truth for all three).
4. ✅ Route + UI — deterministic "Rest up with <patron> (free)" chip when eligible
   (`patronRest` on `ChoiceOption`); `preRest` in the JSON turn; client forwards it.
5. ✅ Prompt — a `YOUR PATRON` context line: warm anchor while under the cap (patch-
   ups free when actually present, offer lean-tagged T0/T1 starter jobs matched to
   `directive`), a "not in the scene, don't conjure them" line while under the cap
   but away, and a "freebies are done, treat as a peer" line once established.
6. ✅ Backfill — handled at load via `ensurePatronSeed` (no DB write needed); the
   patron persists on the next save (it's a campaign NPC → runtime `npcs`).

## Fix — "patron shows up randomly" (2026-07-15)

`patronHelp`'s eligibility originally OR'd two conditions: `patron.locationId ===
currentLocationId` OR presence. A `locationId` is STATION-level (e.g. "Rook"), which
covers the ship, the market, every bar on it — so the location half of the OR made
the free-rest chip (and the model's own `patronRest`) available almost everywhere
the player stood on that station, for a patron the story might never have
introduced yet. Reported case: Angela's Wren Sung, mid-investigation in her own
ship's galley, got a "Rest up with Old Pell (free)" chip for an NPC never mentioned
in play; engaging it yanked the scene to his alcove out of nowhere.

Fix, in `shared/netWorth.ts`:
- **Presence-only.** Dropped the location OR — `present` now means ONLY
  `presentNpcIds.includes(patron.id)`. Being on the same station no longer counts.
- **`needsHelp` gate.** The chip only offers when the PC is actually hurt
  (`hp < maxHp`) or low on stims (`< PATRON_STIM_FLOOR`, =2) — full-health players
  no longer see (and get confused clicking) a free-rest option with nothing to
  rest from.
- **`eligible = present && underCap && needsHelp`** — all three required, backing
  the chip, `restWithPatron()`'s own gate, and the prompt.
- **Prompt reworked** to key its framing on `underCap` (early-game or not), not
  `eligible` — so the model still knows the patron relationship applies even when
  they're away, but is now explicitly told NOT to narrate the patron appearing or
  offer their help unless the player actually travels to them (or the story
  earns it), instead of treating "still early-game" as license to conjure them in.

Tests: `shared/netWorth.test.ts` (patronHelp gating: presence, needsHelp, cap) +
`llm/patronRest.test.ts` (the engine action end-to-end).
