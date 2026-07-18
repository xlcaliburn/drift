# COMBAT_V2.md — squad control + Eclipse-style ship combat

*DESIGN (2026-07-18, Phase 1 — owner direction: "combat more engaging… more
than 1 character to control… [Eclipse-style] ship fights where you had a lot of
customization of your ship, needing power, then you can use it to power either
guns, shields or upgrades… roll 1 dice and have a hit for 4,5,6 or roll 6 dice
that needs to hit a 6"). Companion to STORY.md (the prologue showcases both).
This is also Modularity M5 arriving early: the ship system is the concrete
"second combat system" the CombatSystem interface was designed to wait for.*

## Part A — ground combat: SQUAD CONTROL

**Today:** the player acts; crew auto-act in `crewPhase` (attack the front
enemy; medic stabilizes). Functional, not engaging.

**Design:** the player issues an order to EVERY standing party member each
round — the round becomes: collect N orders (chips grouped per character) →
engine resolves all sides in one pass → one narration beat covers the round.

- **Order set per member = the existing action set** (attack/aim/cover/stim/
  item/switch + role specials: medic stabilize, engineer overcharge — role
  passives already exist in CREW.md). No new action vocabulary for v1.
- **Chips UI:** the combat bar gains member tabs (PC + up to berth-limited
  crew + any temporary ally). Un-ordered members default to their current
  auto-act — so combat NEVER stalls waiting for clicks, and solo play is
  unchanged (one member = today's flow exactly).
- **One turn, one round** stays: all orders ride ONE request (the client
  collects them before submitting), so token cost per round is unchanged.
- **Temporary allies** (STORY.md): story-granted party members with kind
  "party" + a `temporary` flag — controllable like crew, excluded from wages,
  removed by the story. The prologue ally is the first.
- **Enemy side unchanged** (tiers, statuses, majors, fate recording).

**✅ SHIPPED (2026-07-18, HANDOFF_COMBAT_V2_1.md Task C — slice 1 of squad
control):** every standing crew/ally member can be ordered "attack \<chosen
enemy\>" or "stim/item \<self-heal\>" each round; an un-ordered member keeps
today's exact `crewPhase` auto-act, so combat never stalls and solo play is
byte-identical. A patient-less medic can now act on an order instead of
unconditionally holding (stabilize priority stays unconditional whenever a
downed ally exists, regardless of any order). **Narrower than the design
above, by choice:** aim/cover/switch orders aren't wired for crew this slice —
they'd need new persistent per-member `CombatState` fields (today's `aim`/
`cover` bonuses are single PC-scoped fields) that weren't in the handoff's
scope; an aim/cover/switch order on a crew member silently no-ops (held
position) rather than erroring. Chips UI is per-member GROUPS (name + row of
attack/item chips), staged client-side, sent as `combatActions` alongside the
PC's own chip. Full per-member action parity (aim/cover/switch, role
specials like engineer overcharge) is follow-up work, not done here.

## Part B — ship combat: POWER + DICE (the Eclipse core, digital-native)

*Specced: `HANDOFF_COMBAT_V2_2.md` (2026-07-18) is the decision-final
implementation spec for the core — statline/mount tables, simultaneous-reveal
resolution rules, the no-migration player-ship derivation, and the corrected
counter-triangle (the "spray beats shields / evasion beats spray" line below
was mechanically inconsistent; the handoff fixes it to armor-beats-spray /
shields-beat-punch / evasion-beats-precision with a natural-6-always-hits
floor). Where this section and the handoff disagree, the handoff wins.*

Scrap the d20-attack reskin for ship scale. A ship fight becomes an
ENERGY-ALLOCATION duel:

### Power

- A ship has a **reactor output** (per round, from shipClass + upgrades) and
  **systems that consume it**: each weapon mount, shields, engines, and
  special systems have a power cost. Each round the player allocates —
  `4 power: 2→railgun, 1→shields, 1→engines`. Allocation IS the decision;
  the engine resolves everything after.
- **Crew matter:** an engineer adds +1 reactor; a gunner adds +1 to one
  weapon's dice results; a pilot adds evasion per engine power. Crew orders
  in ship scale = station assignments (which system they boost) — the squad
  layer and the ship layer are the same mental model.

### Dice (the owner's tradeoff, made explicit)

Every weapon is a **dice profile**: `N dice, hits on T+, damage D per hit`.
The Eclipse spread, tuned so expected damage is comparable but VARIANCE and
counterplay differ:

| Mount | Profile | Character |
|---|---|---|
| Railgun | 1d6, hits 4+, 3 dmg | reliable single punch — shields blunt it |
| Autocannon battery | 6d6, hit 6, 1 dmg each | swingy spray — great vs low armor, awful vs evasion |
| Beam lance | 2d6, hits 5+, 2 dmg | middle; +1 to hit per extra power (overcharge) |
| Missile rack | 4d6, hits 4+, 1 dmg, ammo-limited | burst; point-defense rolls to shoot them down |

Defense: **shields** absorb per power allocated (recharge = allocation);
**evasion** raises every incoming hit threshold by +1 per engine power (cap
+2) — but a **natural 6 always hits**, so nothing is ever immune, just harder
to land. Armor (hull plating) reduces damage per hit. Rock-paper-scissors
(corrected at implementation — see the shipped-note below): **armor beats
spray** (autocannon's 1 dmg/hit zeroes out against even 1 armor), **shields
beat punch** (a shield point's flat absorption eats a single railgun slug
whole), **evasion beats precision** (a raised threshold hurts a narrow
hit-window like the beam lance far more than a spray that only needs 6s).

### Digital-native extensions (v1 scope: first three)

- **Charge banking:** unspent power banks into a capacitor (cap 2) — spend a
  banked point for an alpha strike or an emergency shield. Rewards planning.
- **Called shots:** overcharge a weapon (+1 power) to target a SUBSYSTEM on a
  hit — knock out their weapons/engines/shields for a round. Fights become
  about disabling, not just HP races (and enable non-lethal ship victories:
  disable + board).
- **Escalating heat:** every round past 4, both sides' reactors +1 (fights
  end; no stalemates).
- *(Later: boarding actions bridging to ground squad combat; environmental
  hazards from the location tier; enemy ship personalities per faction.)*

**✅ SHIPPED (2026-07-18, HANDOFF_COMBAT_V2_2.md — the ship2 core):** power
allocation, all four dice-profile mounts, shields/evasion/armor counterplay
(corrected triangle above), simultaneous-reveal rounds, point defense vs
missiles, and escalating heat. `startShipCombat` now ALWAYS produces a ship2
fight; the old d20 `resolveShipRound` survives only for a fight already
mid-flight at deploy (its stored `system: "classic"` routes it there). Crew
passives are wired as PASSIVE boosts (engineer +1 reactor, gunner +1 die/round,
pilot +1 engine cap) — clickable station assignment (ordering WHICH system a
crew member boosts, per this section's own "station assignments" idea) is not
built; today every standing crew member always contributes every passive at
once. **Not shipped, still slice 3/4:** customization (slots + market + dock
install), charge banking, called shots. The ship's derived ship2 profile is
NOT persisted on the `Ship` row itself — no migration — it's computed at fight
start from the existing fields (shipClass/weapons/hasShield/damageReduction/
evasiveAcBonus) and frozen into `combat.ship2` for that fight's duration.

### Customization (the Eclipse joy)

*Specced: `HANDOFF_COMBAT_V2_3.md` (2026-07-18, READY TO IMPLEMENT) — slot
caps + an outfitting catalog in the ship2 pack module, buy-installs/strip-
sells through the existing market machinery (rep pricing, engine haggle, tier
gating), writing into the EXISTING Ship columns so slice 2's derivation is
the payoff (no schema change, no migration). Includes the multi-mount
instance-key fix slice 2's review flagged. Where this section and the handoff
disagree, the handoff wins.*

Ships get **slots** (per shipClass: mounts + system slots). The market sells
mounts/systems (pack catalogs — weapons.json already sketches types); dock
services install them. Loadout IS the build game; net-worth scaling gates the
shelf. Existing ship fields (shield/PD/burst drive) become systems in slots.

### Architecture (the M5 seam, built for real now)

- `CombatSystem` interface: `start(specs) → state`, `resolveRound(state,
  orders) → {state, lines, outcome}`, `chips(state) → per-member choices`.
- Current d20 machinery becomes `combat/ground/` (+ squad orders); the new
  power system is `combat/ship/`. `CombatState` becomes a discriminated
  union (jsonb persistence doesn't care; a load-time normalizer handles
  legacy in-flight fights — the jsonb rule).
- Numbers (reactor outputs, profiles, costs) are PACK CATALOG data —
  a fantasy world later reskins "reactor" as whatever it wants.
- The narrator's job shrinks further: it narrates the resolved round from
  engine lines (as today) and never touches allocation math. `combatStart`
  keeps working — the model proposes THAT a fight starts; the engine builds it.

## Tutorial (see STORY.md §3)

The prologue scripts one forgiving fight of each kind: ground WITH the
temporary ally (teaches orders-per-member), then the loaner-ship duel
(teaches allocation + the 1-die-vs-6-dice tradeoff explicitly — the enemy is
built so either strategy can win, and the ally comments on the choice).

## Build order (each slice = one handoff)

1. ✅ **Squad orders (ground)** — SHIPPED (HANDOFF_COMBAT_V2_1.md).
2. ✅ **CombatSystem seam + ship v2 core** (power, profiles, shields/evasion/
   armor, heat) behind the ship scale — SHIPPED (HANDOFF_COMBAT_V2_2.md).
3. **Customization** (slots + market + dock install). Specced —
   `HANDOFF_COMBAT_V2_3.md`, READY TO IMPLEMENT.
4. **Charge banking + called shots** (small, after the core proves fun).
5. **Prologue integration** (with STORY.md).

## Decisions (RESOLVED 2026-07-18 — owner approved recommendations)

- **Ship loss stays non-lethal**: hull 0 = adrift, not death.
- **Simultaneous reveal**: both sides' allocations resolve together each
  round — prediction is the skill; reads better in prose.
- **Ground combat stays d20 + verbs**: the two scales FEELING different is a
  feature. Dice pools are ship-only.
- **Sequencing** (owner q: "architecture first, esp M5?"): M5 is NOT separate
  prior work — it's the OPENING SLICE of this effort, scoped as an extraction
  shaped by its two now-designed consumers (ground-with-squad + ship-power),
  never a speculative abstraction. See HANDOFF_COMBAT_V2_1.md. The one true
  pre-step: seed the M2 lexicon facade so new combat code doesn't deepen the
  wording debt. M3/M4 are NOT blockers and stay deferred.
