# DRIFT — Shared-World Multiplayer (Season Concept)

*A pivot from the solo Vess campaign to a shared-world narrative game for ~5–6 friends. Space-opera setting kept. This is NOT a strategy/4X game — no meters, scores, or captured planets. Influence and expansion are emergent and judged as story.*

## The concept in one breath

Each player plays a grounded character embedded in an existing DRIFT faction, running their own private story on the existing character engine (skills, rolls, combat, economy). Everyone's game reads and writes **one shared world**. Big actions ripple out as canon the GM weaves into others' scenes — and players' characters can actually cross paths, with the GM playing another player's character as a faithful NPC drawn from their real stats, history, and voice. Over a fixed-length **season**, the collective actions reshape which factions rise, fracture, or fall, resolved as a story reckoning rather than a scoreboard.

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

## Character creation (guided, steers the whole story)

A short questionnaire at the start. Answers seed stats AND steer the story hooks the GM surfaces. Proposed axes:

1. **Faction** — which power you start inside (Hollow Crown, Sable Chain, The Undertow, Ledger network, Meridian commerce, Talos security, or unaligned). Sets starting allies/enemies, reputation, and your opening tie to the season spine.
2. **Focus / bias** — what you're good at and lean toward: *Commerce · Combat · Intrigue · Piloting · Diplomacy*. Weights your starting skills and the kinds of opportunities the GM offers.
3. **Moral code** — a one-line "line you won't cross" (like Vess's *people aren't cargo*) plus a lean: *ruthless · pragmatic · principled*. Shapes how NPCs/factions react and the tone of your hooks.
4. **Background / origin** — *ex-military · dock rat · corporate insider · salvager · fixer …*. Gives a signature skill, starting gear, and a personal hook.
5. **Ambition** — what you're ultimately after: *wealth · command · freedom · revenge · a cause · belonging*. Drives your personal arc and sets the condition that triggers the **break-away-from-your-faction** beat.

The engine turns these into concrete attributes/skills (bias → skill weighting, background → gear + one signature skill, etc.), so no manual stat math for players. Everyone can start in a *different* faction, or several inside the *same* one with divergent loyalties.

**Equal footing.** Everyone starts as close to parity as the story allows — creation answers change your *shape* (what you're good at, who you know, what you want), not your *power level*. No player begins with a head start in resources; advantage is earned in play. Where the story demands asymmetry (e.g., a corporate insider begins with contacts a dock rat lacks), it's offset elsewhere so no one opens ahead.

## What we now have to save (the new data)

Cross-player NPC play requires a **public dossier** per character — the read surface other players' games pull from. Split public vs private:

**Public (shared canon, auto-maintained):**
- Name, faction & role, reputation as publicly known
- Notable deeds — the canon world-events they caused or featured in
- A capability tier derived from their real stats (so the GM can stat them faithfully as an NPC in combat/opposed checks)
- Current standing/situation (rising, cornered, allied with X, at war with Y)
- Voice/personality notes from creation (so the GM roleplays them consistently)

**Private (that player's game only):**
- Full sheet detail, unrevealed plans, secrets, in-progress scenes

The dossier updates as they play — deeds accrue, standing shifts. Because it's fully AI-run, world-events default to **canon** (no approval queue yet); a human-curation step can be added later if a runaway thread ever needs reining in.

### Relationship ledger (who-knows-what)

A dossier being *public* doesn't mean every character *knows* it. Each character carries a **relationship ledger**: a per-character log of who they've met or heard of, keyed to other characters and NPCs, holding:
- **How they know them** — firsthand (met, worked/fought with) vs. secondhand (rumor, reputation) vs. unknown
- **Relationship** — ally / rival / enemy / neutral / owed / owes, plus a warmth/trust lean
- **What they actually know** — which of the target's deeds/facts have reached them (not the full public record)
- Notes and history of their interactions

This is what gates cross-player encounters. When your character meets mine, the GM reveals only what *your ledger* says you know — firsthand contacts see the real person and their known deeds; a stranger gets rumor and reputation, or nothing. Meeting someone, or a deed becoming widely known, writes new entries into ledgers. It's the realistic "you only know what you've learned" layer over the shared canon, and it doubles as each player's personal Rolodex of allies and enemies.

## Season structure

A **season** is a shared object: a central premise (the "spine"), the factions/tensions in play, a fixed start and end date, and an evolving state that accumulates everyone's world-events. On the end date the GM generates a **state-of-the-universe reckoning** — how each faction fared, who rose or fell, what each player's character became — then a new season opens carrying the changed world forward.

**Proposed Season 1 spine (drawn straight from existing canon):**
> *The Hollow Crown's grip on the Meridian–Rook lanes is cracking. The Sable Chain is pushing in openly, the Undertow smells opportunity, and ambitious insiders are choosing sides. Every character starts somewhere in this fault line.*

This reuses the exact situation already in the save file, so the world has instant history and pressure.

## How cross-player-as-NPC works

When Player A's scene would involve Player B's character, the GM pulls B's public dossier (stats, deeds, voice, current standing) and plays B faithfully as an NPC — B's established actions are real and binding, but the GM improvises B's moment-to-moment behavior. B is never puppeted into contradicting what the real player has done. Later, B's own game may reflect the encounter (A appears in B's story via the same mechanism). No real-time sync required — it's async, mediated entirely through the shared dossiers + world-events.

## What changes vs. the current build

Mostly additive — the character engine is untouched:
- **Add**: player accounts/auth, a character-creation flow, a `seasons` table + spine, a public `dossier` derived per character, cross-campaign dossier reads in the prompt builder, and a "break-away" story trigger.
- **Reuse as-is**: the whole engine (rolls, combat, ticks, clocks, economy), the narrator loop + tools, the `world_events` seam (now the core loop, default canon), the Universe→Campaign→Character schema (each player = a campaign in the shared universe).
- **Drop**: the single hard-coded Vess campaign becomes one of many; Vess can stay as an example character or retire.

## Open defaults (flag to change)

- World-events auto-publish as canon (fully AI-run). Human curation deferred.
- Season length: suggest ~4 weeks for the first run.
- Persistence becomes mandatory here (multiplayer needs a real DB) — Supabase moves from optional to required. **User is wiring Supabase up next.**

## Build split: DB-independent vs. needs Supabase

Can be built/prototyped in-memory now, ready to connect:
- Character-creation questionnaire + the answer→stats mapping engine
- Zod schemas for the public dossier, the relationship ledger, and the season/spine
- Season spine data (Season 1) and the "state of the universe" reckoning generator
- The break-away-from-faction story trigger

Needs the real backend (user's next task):
- Player accounts / auth
- Cross-campaign reads (pulling another player's dossier + your ledger into the prompt)
- Persisting dossiers, ledgers, world-events, and per-player campaigns durably
