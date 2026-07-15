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
  (`restWithPatron`) does the lot, gated to `netWorth < 600` AND being at the
  patron's location (or the patron present).
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
   ¢600 AND patron here/present) → HP + hull to full, clears Downed + death-saves,
   stims to a floor of 2, ¢120 stipend when broke (< ¢40); returns a 🛟 line.
   `patronHelp(state, presentNpcIds)` in `shared/netWorth` backs the chip + prompt.
4. ✅ Route + UI — deterministic "Rest up with <patron> (free)" chip when eligible
   (`patronRest` on `ChoiceOption`); `preRest` in the JSON turn; client forwards it.
5. ✅ Prompt — a `YOUR PATRON` context line: warm anchor while eligible (patch-ups
   free, offer lean-tagged T0/T1 starter jobs matched to `directive`), and a
   "freebies are done, treat as a peer" line once established.
6. ✅ Backfill — handled at load via `ensurePatronSeed` (no DB write needed); the
   patron persists on the next save (it's a campaign NPC → runtime `npcs`).

Tests: `shared/netWorth.test.ts` (patronHelp gating) + `llm/patronRest.test.ts`
(the engine action end-to-end).
