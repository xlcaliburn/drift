# DRIFT — Shared-World Multiplayer (Season Concept)

*A shared-world narrative game for ~5–6 friends. Space-opera setting kept. This
is NOT a strategy/4X game — no meters, scores, or captured planets. Influence and
expansion are emergent and judged as story.*

*Status: the foundations have shipped — universe-shared NPCs (generated NPCs
promote to the universe-scoped `npcs` table; any player can meet them by name,
per-player standing stays in each campaign's `npc_relations` overlay), backstory
NPCs seeded at creation, `log_world_event` firing in solo play, and the schemas
(`shared/multiplayer.ts`: Dossier, LedgerEntry, Season). What remains is the
shared-world **runtime** — dossiers, ledgers, cross-campaign reads, seasons.*

## The concept in one breath

Each player plays a grounded character embedded in an existing DRIFT faction,
running their own private story on the existing character engine (skills, rolls,
combat, economy). Everyone's game reads and writes **one shared world**. Big
actions ripple out as canon the GM weaves into others' scenes — and players'
characters can actually cross paths, with the GM playing another player's
character as a faithful NPC drawn from their real stats, history, and voice. Over
a fixed-length **season**, the collective actions reshape which factions rise,
fracture, or fall, resolved as a story reckoning rather than a scoreboard.

## Decisions locked (from design Q&A)

| Question | Decision |
|---|---|
| What you control | A character (leader-in-the-making), not an abstract faction |
| Start position | Embedded inside an existing faction; story offers an early break-away beat |
| Competition | Mixed — build/expand, with room to raid, deal, betray, ally |
| Turn structure | Async free-play — act anytime; the world updates continuously |
| AI role | Hybrid — engine resolves mechanics; AI GMs the fiction |
| Influence model | **Story outcome, not a leaderboard** — no meters, no node-capturing |
| Season end | **Fixed date**; GM writes a "state of the universe" reckoning |
| Referee | **Fully AI-run** to start (no human curation of canon yet) |
| Cross-player contact | **Yes** — GM plays other players' characters as NPCs from their saved profile |
| Group size | ~5–6; faction chosen during character creation |

---

## Remaining work

### 1. Public dossier per character (auto-maintained)

Cross-player NPC play requires a **public dossier** — the read surface other
players' games pull from. Split public vs private:

**Public (shared canon, auto-maintained during play):**
- Name, faction & role, reputation as publicly known
- Notable deeds — the canon world-events they caused or featured in
- A capability tier derived from their real stats (so the GM can stat them
  faithfully as an NPC in combat/opposed checks)
- Current standing/situation (rising, cornered, allied with X, at war with Y)
- Voice/personality notes from creation (so the GM roleplays them consistently)

**Private (that player's game only):**
- Full sheet detail, unrevealed plans, secrets, in-progress scenes

The dossier updates as they play — deeds accrue, standing shifts. Fully AI-run,
so world-events default to **canon** (no approval queue yet); a human-curation
step can be added later if a runaway thread ever needs reining in.

### 2. Relationship ledger (who-knows-what)

A dossier being *public* doesn't mean every character *knows* it. Each character
carries a **relationship ledger**: a per-character log of who they've met or
heard of, keyed to other characters and NPCs, holding:
- **How they know them** — firsthand (met, worked/fought with) vs. secondhand
  (rumor, reputation) vs. unknown
- **Relationship** — ally / rival / enemy / neutral / owed / owes, plus a
  warmth/trust lean
- **What they actually know** — which of the target's deeds/facts have reached
  them (not the full public record)
- Notes and history of their interactions

This gates cross-player encounters. When your character meets mine, the GM
reveals only what *your ledger* says you know — firsthand contacts see the real
person and their known deeds; a stranger gets rumor and reputation, or nothing.
Meeting someone, or a deed becoming widely known, writes new entries into
ledgers. It's the realistic "you only know what you've learned" layer over the
shared canon, and doubles as each player's personal Rolodex of allies and enemies.

### 3. Cross-campaign reads + cross-player-as-NPC

When Player A's scene would involve Player B's character, the GM pulls B's public
dossier (stats, deeds, voice, current standing) — gated by A's ledger knowledge —
and plays B faithfully as an NPC. B's established actions are real and binding,
but the GM improvises B's moment-to-moment behavior; B is never puppeted into
contradicting what the real player has done. Later, B's own game may reflect the
encounter via the same mechanism. No real-time sync — async, mediated entirely
through the shared dossiers + world-events. Build: pull another player's dossier +
your ledger into the prompt builder.

### 4. Break-away-from-faction story trigger

Each character starts embedded in a faction; the story offers an early
break-away beat. The **ambition** answer from character creation sets the
condition that triggers it. Build the trigger + the story hook it fires.

### 5. Seasons (fixed end date + reckoning)

A **season** is a shared object: a central premise (the "spine"), the
factions/tensions in play, a fixed start and end date, and an evolving state that
accumulates everyone's world-events. On the end date the GM generates a
**state-of-the-universe reckoning** — how each faction fared, who rose or fell,
what each player's character became — then a new season opens carrying the
changed world forward.

**Proposed Season 1 spine (drawn straight from existing canon):**
> *The Hollow Crown's grip on the Meridian–Rook lanes is cracking. The Sable
> Chain is pushing in openly, the Undertow smells opportunity, and ambitious
> insiders are choosing sides. Every character starts somewhere in this fault
> line.*

This reuses the situation already in the save file, so the world has instant
history and pressure.

### 6. Optional canon review queue (deferred)

World-events auto-publish as canon (fully AI-run). The `world_events.visibility`
flag already exists; a human-curation step (universe owner marks events canon vs
private) can be added later to rein in a runaway thread.

---

## Equal footing (governs the shipped creation flow and any additions)

Everyone starts as close to parity as the story allows — creation answers change
your *shape* (what you're good at, who you know, what you want), not your *power
level*. No player begins with a head start in resources; advantage is earned in
play. Where the story demands asymmetry (e.g., a corporate insider begins with
contacts a dock rat lacks), it's offset elsewhere so no one opens ahead.

## Open defaults (flag to change)

- World-events auto-publish as canon (fully AI-run). Human curation deferred.
- Season length: suggest ~4 weeks for the first run.
