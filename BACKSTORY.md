# BACKSTORY.md — making backstory an active ingredient, not passive lore

*DESIGN (2026-07-16) — reaction to a live case (Lyra Vale): a freshly-retconned love
interest + a standing "double life" thread were confirmed reaching the narrator's
context on every turn for 100+ turns straight, and the model never once wove either
into the actual story. The context was there; nothing forced the model to ACT on it.
This doc is the fix: make surfacing backstory an engine-selected EVENT, the same
invariant as everywhere else in DRIFT — the engine decides WHEN and WHAT, the
narrator only dramatizes it.*

## The one invariant (same as everywhere)

The engine picks which backstory anchor is due and hands the narrator a concrete
directive ("weave in X now"); it never leaves the decision to the model's judgment.
Passive context (an NPC's relation line, `moralCode` fed every turn) stays exactly as
it is — this adds a forcing function on TOP of it, it doesn't replace it.

## Phase 1 — the tenday-pressure backstop (SHIPPED 2026-07-16)

The mechanism that actually would have caught Lyra's case. A sibling of the existing
tenday-tick pattern (crew wages, market rotation): track tendays since a backstory
beat last surfaced; once a threshold passes, the NEXT turn's context carries an
explicit, concrete directive instead of hoping the model notices on its own.

- **`shared/backstoryPressure.ts`** (pure, no RNG — this SELECTS the most
  significant anchor, it doesn't roll for one):
  - `backstoryPressureDue(campaign)` — `tendaysElapsed - (lastBackstoryBeatTenday ?? 0)
    >= BACKSTORY_PRESSURE_TENDAYS` (4, tune from play data).
  - `selectBackstoryBeat(state, npcRelations, presentNpcIds)` — picks ONE anchor,
    ranked: a creation-relation NPC tie (highest disposition wins, present-in-scene
    and the patron excluded — the patron runs its own presence system) → the PC's
    `ambition` → their `moralCode` → `null` only if truly nothing is set. Never
    empty for a real character (every PC gets a `moralCode` at creation).
- **`llm/promptSections/backstoryPressure.ts`** — a new context section, silent
  unless pressure is due. Self-contained: derives everything from `state` +
  `memory.npcRelations`, already in every `SectionCtx` — no new argument threaded
  through `jsonTurn.ts`, so it can't collide with work in progress there. Phrasing
  respects the home-location invariant (`world.ts`'s proximity gate, shipped the
  same day): an away NPC is reached through comms/rumor/reflection, **never**
  teleported into the scene just because pressure fired.
- **`Campaign.lastBackstoryBeatTenday`** (optional, migration `023_backstory_pressure`)
  — mirrors `tendaysElapsed`/`directive`: a plain column, not a runtime jsonb slice,
  since it's simple per-campaign scalar bookkeeping. Undefined means "never yet" —
  pressure is measured from campaign start, not exempted.
- **Reset in `app/api/turn/route.ts`**, right after the existing tenday-tick block
  (`advanceTendays`/`chargeCrewUpkeep`) — checked against the PRE-turn campaign (what
  the prompt section actually saw this turn) and reset regardless of how well the
  model followed through, the same best-effort spirit as `moralCode`/`ambition`
  elsewhere: a nudge, not a hard gate.

## What's LEFT (Phase 2+)

Ideas from the same brainstorm, not yet built — each plugs into a different moment
instead of the tenday clock:

- **Arrival-richness tie-in** — `TRAVEL.md`'s arrival pass already picks one of two
  grounding elements (complication / routine lead) on every genuine arrival. Add a
  third, weighted branch: a backstory callback, selected when an anchor concretely
  matches the destination (a relation NPC based there, a faction the PC's backstory
  ties to). Same selection function as Phase 1, different trigger.
- **NPC-initiated contact** — flip the direction: on a tenday tick, roll whether a
  high-disposition relation NPC reaches out on their OWN (a message, a visit, a
  warning) rather than only ever surfacing when the player brings them up.
- **Milestone-crossing beats** — tie a `payoutRamp` tier-up, a faction-rep threshold,
  or `loyaltyToParent` cratering (all engine-detected already) to a ONE-TIME personal
  beat keyed to the PC's `ambition` ("Wealth" + tier-up → what the money was supposed
  to fix).
- **Crisis-moment callback** — a guaranteed backstory flash on going Downed
  (COMBAT.md's Bleeding Out already gets dedicated narrative treatment); highest
  emotional leverage, currently left to chance.
- **Quiet/downtime beats** — dock stays, patron rest, scene-end housekeeping — a
  lower-stakes home for reflection so the pool doesn't only fire in dangerous beats.
- **Structured backstory tags** — the real gap underneath all of this: only
  `moralCode`, `ambition`, and creation-relation NPCs are structured enough to select
  from; the prose `backstory` field itself can't be parsed programmatically. Phase 2
  should have `creationFinalize` also emit 2-3 short structured tags (e.g.
  `{anchor:"faction", refId:"f-sable", note:"secret loyalty"}`) so later phases have
  concrete things to point at instead of guessing from free text.
