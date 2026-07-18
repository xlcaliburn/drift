# HANDOFF — Combat V2 slice 2: the ship2 CombatSystem (power + dice)

*Strategy phase output (Fable, 2026-07-18). Read `WORKFLOW.md` first, then this
doc fully. Designs are DECIDED (COMBAT_V2.md Part B, decisions resolved
2026-07-18). Predecessor: `HANDOFF_COMBAT_V2_1.md` (shipped — the seam this
slice plugs into). Worked examples of the process: `HANDOFF_NPC_CANON.md`,
`HANDOFF_MODULARITY_M1.md`.*

## Context

Ship-scale combat today is a d20 reskin of ground combat (`resolveShipRound`
in `llm/runtimeCombat.ts`). This slice replaces it for NEW fights with the
Eclipse-style **power-allocation duel**: a reactor outputs N power per round,
the player allocates it across weapon mounts / shields / engines, both sides'
allocations resolve SIMULTANEOUSLY, and every weapon is a dice profile
(1 reliable die vs 6 swingy dice — the owner's core tradeoff). The seam is
already live: `SYSTEMS` in `runtimeCombat.ts` dispatches by `combat.system`,
and `"ship2"` currently aliases classic. This slice makes it real.

**What stays classic:** ground combat (untouched), and any LEGACY ship fight
already mid-flight at deploy (its stored `system: "classic"` keeps routing it
through `resolveShipRound`, which is NOT deleted).

## ⚠ THE TRAPS for this handoff

1. **jsonb again.** `CombatState` gains an optional `ship2` slice and
   `CombatEnemy` gains optional ship2 fields. Only NEW fights carry them, so
   no load-time normalization is needed for them — but VERIFY the existing
   normalization (`{ system: "classic", ...runtime.combat }` in
   `lib/state.ts`) still lets a STORED `"ship2"` win the spread. It does
   (stored keys overwrite the seeded default) — don't "simplify" it into the
   other order.
2. **Zero behavior change for ground and for legacy ship fights.** The full
   suite is the pin. `resolveShipRound` stays, byte-identical, reachable via
   `system: "classic"`.
3. **Interface-level guards stay put** (review-checklist class 2): NPC-fate
   recording and the personal-scale-only exemption live in the
   `resolveCombatRound` dispatcher; net-worth/count clamps live in the
   `combatStart` handler. Neither moves into ship2.
4. **Chips must be CLIENT-buildable.** `PlayClient.tsx` rebuilds combat chips
   on reload (line ~148) — everything the client needs (presets, allocation
   validation, derive-profile) lives in `shared/`, never `llm/`. `llm/` may
   import shared, not vice versa.
5. **New engine strings use `shared/lexicon.ts`** (`fmtCredits`, not a bare
   `¢`). Old lines stay as they are (M2's job).
6. **The engine never trusts the client's allocation.** The route zod-shapes
   it; the ENGINE re-validates against the real reactor/mounts/caps and
   clamps. A crafted `alloc` must not overspend, power an un-owned mount, or
   go negative.
7. **Determinism.** Enemy allocation policy + all dice through `rt.rng` only.
   No `Math.random`, no map/set iteration order dependencies in resolution.

---

## The system (decision-final numbers — tune later via pack edits only)

### Statlines — `content/pack/drift/ship2.json` (new pack catalog)

Keyed by the existing `shipClass` enum, used for BOTH sides:

| class | reactor | engineCap | shieldCap | armor | mounts |
|---|---|---|---|---|---|
| scout | 3 | 3 | 0 | 0 | autocannon |
| fighter | 4 | 2 | 0 | 0 | railgun, autocannon |
| hauler | 3 | 1 | 1 | 1 | railgun |
| gunship | 5 | 1 | 2 | 0 | railgun, beamLance |
| corvette | 6 | 1 | 2 | 1 | railgun, autocannon, missileRack |

Mount profiles (same file):

| mount | dice | hitOn | dmg/hit | power | special |
|---|---|---|---|---|---|
| railgun | 1 | 4+ | 3 | 2 | — |
| autocannon | 6 | 6 | 1 | 2 | — |
| beamLance | 2 | 5+ | 2 | 2 | overcharge: +1 power → hits on 4+ |
| missileRack | 4 | 4+ | 1 | 2 | consumes 1 ammo per volley; enemy PD rolls 1d6 per incoming hit, 5+ shoots it down |

Also in the file: enemy **allocation policies** per class (a weight list the
engine resolves deterministically — e.g. gunship `["guns","guns","shields"]`:
fill in order until reactor is spent; scout `["engines","guns"]`). Keep them
dumb and readable; personality is slice-later.

### Resolution rules

- **Costs:** each mount = its `power` to fire this round; shields = 1/point
  (max `shieldCap`); engines = 1/point (max `engineCap`). Unspent power is
  LOST (charge banking is slice 4).
- **Shields:** each point allocated absorbs 2 incoming damage this round
  (a per-round pool, no persistence).
- **Evasion:** each engine point raises every incoming die's hit threshold
  by +1, capped at +2 total. **A natural 6 ALWAYS hits** — nothing is immune.
- **Armor:** flat −N damage per HIT (not per volley), min 0.
- **The counter-triangle** (corrected from COMBAT_V2.md's sketch, which was
  mechanically inconsistent — see the doc update in Task D): **armor beats
  spray** (−1/hit zeroes 1-dmg autocannon hits), **shields beat punch** (the
  pool eats a single 3-dmg railgun slug), **evasion beats precision** (4+/5+
  profiles suffer most; 6-only spray loses nothing to it). The 1-die-vs-6-dice
  variance tradeoff is untouched.
- **Simultaneous reveal:** collect the player's allocation + every enemy's
  policy allocation, roll everything, apply damage to BOTH sides regardless
  of what dies. Mutual destruction resolves as **"disabled"** (you're adrift
  among the wrecks — no salvage; the E-3 dock/debt loop is the recovery).
  Victory (all enemies at 0, hull above 0) pays the existing ship
  `LOOT_BAND` salvage line, via `fmtCredits`.
- **Escalating heat:** both sides' reactors get `+max(0, round − 4)` — grows
  every round past 4, so stalemates die.
- **Heat/round lines:** ONE summary line per side per round (crew-phase
  style), not one per die. Show the math compactly:
  `🎲 Railgun 2P: d6(5) ≥ 4 → 3 dmg · shields absorb 2 → hull −1`.
- **Surprise** (replaces classic's free volley for ship2 only): the ambushed
  side's reactor is −1 in round 1; the ambusher's +1. `beginCombat` branches:
  ship2 fights skip `enemyShipVolley` on `surprise === "enemy"` and stamp the
  modifier into `combat.ship2` instead. Personal scale untouched.
- **Multi-enemy:** the player picks ONE target per round (all mounts fire at
  it); each enemy ship allocates and fires independently. Per-mount targeting
  is out of scope.
- **Flee:** unchanged mechanics (burst drive auto-escape, else d20 piloting
  vs `fleeDC`) — dice pools are for WEAPONS; skill checks stay d20 — plus
  `+1 per engine point allocated that round` to the roll (allocation still
  resolves first; enemies still fire at you as you run).
- **Items:** `alloc.itemId` rides the allocation (a free action, like ground's
  weapon switch): `shieldCell` → +2 bonus shield pool this round (validated
  held, consumed). Out-of-combat ship items (`patchkit`, `missiles`) are
  untouched.
- **Missile ammo:** single source of truth stays `state.ship.weapons[].ammo`
  (player side) — read live, decrement on fire, so the reload consumable
  keeps working. Enemy racks get a fixed 4-ammo counter on the spawned enemy.
- **Crew stations (passive this slice, like role passives):** an aboard
  engineer = +1 reactor; a gunner = +1 to ONE die result per round (applied
  to the best candidate die: the highest miss, deterministically); a pilot =
  +1 engineCap. Standing (`hp > 0`, not dead) members only. Clickable station
  REASSIGNMENT is a later slice — do not build order chips for ship scale.

### Player-ship derivation (NO Ship schema change, NO migration)

At fight start, derive the player's ship2 profile from the existing `Ship`
row + the class table, and FREEZE it into `combat.ship2.player`:

- Base statline = class table row for `ship.shipClass`.
- Mounts: map `ship.weapons[]` by `type` — kinetic→railgun, energy→beamLance,
  ion→autocannon, missile→missileRack (keep the weapon's `name` for the line
  label; profile numbers from the catalog). Empty `weapons[]` → the class's
  default mounts.
- `hasShield` false → shieldCap 0 (a hauler with no shield emitter can't
  allocate to shields); true → class shieldCap (min 1).
- `damageReduction > 0` → armor = max(class armor, 1).
- `evasiveAcBonus > 0` → engineCap +1.
- Hull stays `ship.hp/maxHp` — damage flows through the existing
  `applyShipDamage` (disabled-at-0 behavior and its event line unchanged).

## Task A — pack catalog + pure math (`engine/ship2.ts`, `shared/ship2.ts`) ✅ SHIPPED

*Implementation decisions: the catalog is `content/pack/drift/ship2.ts` — a
TYPED `.ts` module, not raw JSON (the handoff's literal `ship2.json`) —
because `policy` needs its real `"guns"|"shields"|"engines"` literal union to
validate meaningfully; a raw JSON import only infers `string[]`. Matches the
precedent of creation/briefs/openings/npcFlavor, which are `.ts` for the same
reason. `PackShip2` is a dedicated top-level `ContentPack` field (not folded
into the loose `catalogs` record), with `validatePack` checks that every
class's mounts resolve and every shipClass in the OLD `catalogs.shipClasses`
also has a ship2 statline. Two extra pure helpers beyond the handoff's list,
both needed by Task B and kept in Task A's files for cohesion:
`deriveEnemyShip2Profile`/`ship2ClassPolicy` (shared/ship2.ts) and
`resolvePolicyAllocation` (engine/ship2.ts) — an enemy's allocation is
re-derived fresh every round (no crew passives to freeze, unlike the
player's), resolved deterministically from its class + policy tokens, no rng.
`rollMount`'s signature ended up `(mount, {evasionBonus, overcharged}, rng)`
returning a richer `MountFireResult` (mountId/name/power/dmgPerHit carried
through) rather than the sketched "per-die results + hits", so `resolveVolley`
never needs the mount-profile map again downstream. 47 tests landed with this
task (20 engine, 25 shared, 2 pack completeness);
`resolvePolicyAllocation`/`deriveEnemyShip2Profile`/`ship2ClassPolicy` picked
up their own tests alongside Task B, once its round resolution actually
exercised them — see that task's note for the full count.*

1. `content/pack/drift/ship2.json` — the tables above (+ zod `PackShip2` in
   `content/pack/types.ts`, wired through `pack/drift.ts` and validated by
   `pack.test.ts`: every `shipClass` has a statline, every mount referenced
   exists, every policy token is valid).
2. `shared/ship2.ts` (CLIENT-SAFE — types + everything the UI needs):
   - Types: `Ship2Profile` (reactor/engineCap/shieldCap/armor/mounts),
     `Ship2Mount` (id/name/profile ref/ammo?), `Allocation`
     (`{ mounts: string[]; shields: number; engines: number; overcharge?:
     boolean; targetId?: string; itemId?: string }` — mounts listed = fired).
   - `deriveShip2Profile(ship, crew)` — the derivation + crew passives above.
   - `validateAllocation(profile, alloc)` → clamped legal allocation (never
     throws; drops what doesn't fit, in mounts→shields→engines order).
   - `ship2Presets(profile, enemies, consumables)` → the engine-generated
     preset chips (label + a complete `combatAction`), ~4: **Alpha strike**
     (all guns, no defense), **Guns + shields**, **Evasive attack** (best gun
     + engines), **Run silent** (shields + engines, no fire), plus
     `Divert <shield cell>` when held and a flee chip (burst-drive label when
     ready) — mirroring today's chip labels/verbs where they exist.
3. `engine/ship2.ts` (pure, rng-injected): `rollMount(profile, evasion,
   overcharged, gunnerBoost, rng)` → per-die results + hits; `resolveVolley`
   (hits → PD roll-down for missiles → armor per hit → shield pool → net
   damage + a compact breakdown string). Exact-math unit tests (seeded): the
   natural-6 rule, evasion cap, armor-zeroing spray, pool exhaustion order,
   PD, overcharge threshold shift, heat formula.

## Task B — the ship2 `CombatSystem` (`llm/combat/ship2System.ts`) ✅ SHIPPED

*Implementation decisions: implemented IN-PLACE in `llm/runtimeCombat.ts`
(`resolveShip2Round`/`finishShip2Round`, registered as `ship2System` in
`SYSTEMS`) rather than a separate `llm/combat/ship2System.ts` file —
matching `classicSystem`'s own precedent in HANDOFF_COMBAT_V2_1 ("prefer
wrapping in place... churn is risk, not value"): it needs this file's
private `pcOf`/`applyShipDamage`/`LOOT_BAND`/`fleeDC` helpers, and a file
split would just re-export them. `surpriseMod` ended up a plain `number`
(not the sketched `1 | -1`) since escalating heat ADDS to the same reactor
modifier the surprise sets, and the combined value needs to be a general
integer. **Heat was missing from the handoff's own numbered steps** (only
mentioned in COMBAT_V2.md's design prose) — added per that doc: both sides'
reactors get `+max(0, round − 4)`, computed alongside the surprise mod as one
`enemyReactorMod`/`playerReactorMod` pair. `ship2ClassPolicy`'s resolution
and the enemy's per-round profile re-derivation (not frozen, unlike the
player's) live in Task A's files, not here — see that task's note. 37 new
tests across `llm/ship2System.test.ts` (16), `combatSystemSeam.test.ts` (+2),
`combatEngine.test.ts` (+2 for `spawnCombatShips`' new `ship2Class`/
`missileAmmo` fields), plus the Task-A-adjacent additions mentioned there.*

1. `shared/combat.ts`: `CombatState` gains `ship2?: { player: Ship2Profile;
   surpriseMod?: 1 | -1 }`; `CombatEnemy` gains optional `ship2Class?:
   ShipClass` + `missileAmmo?: number` (enemy profiles re-derive from class —
   don't freeze full enemy statlines into jsonb).
2. `startShipCombat` stamps `system: "ship2"` and populates `combat.ship2`
   (all three callers — `applyPlan/combat.ts`, `openFight.ts` ship reroute —
   get it automatically). `beginCombat` gets the ship2 surprise branch
   (trap: personal + legacy paths byte-identical).
3. `llm/combat/ship2System.ts` implements `CombatSystem.resolveRound`:
   read the PC's order (an `allocate`-type `CombatAction`; any OTHER action
   type maps to flee/item as today, and a missing/malformed one falls back to
   the **Guns + shields** preset — combat never stalls), build enemy
   allocations from policy, resolve simultaneously per the rules, reuse
   `applyShipDamage` / `LOOT_BAND` / `fleeDC`. Register in `SYSTEMS`
   (replacing the classic alias). `resolveShipRound` untouched.
4. `interpretCombatText` (`shared/combat.ts`): a ship2 branch mapping typed
   text to presets (fire/attack words → Alpha strike or Guns + shields;
   evasive/dodge → Evasive attack; shield words → Run silent; flee/run/burst
   → flee; use/divert → item) — typing can never skip the round.
5. Tests (`llm/ship2System.test.ts`, seeded): a full round damages both sides
   simultaneously; victory pays salvage; mutual kill → disabled; hull 0 →
   disabled + fight over; enemy policy allocation is deterministic; crew
   passives shift the math; heat kicks in round 5; a stored `system:"ship2"`
   fight resolves via the real system while a stored `"classic"` SHIP fight
   still resolves via `resolveShipRound` (extend `combatSystemSeam.test.ts`).

## Task C — protocol + chips + the allocation panel ✅ SHIPPED

*Implementation decisions: `CombatSystem` did NOT gain a `chips()` interface
method as sketched — `combatChipsFor()` dispatches on `combat.system` directly
in `shared/combat.ts` instead, deliberately bypassing the `llm/` registry
(trap 4: this module has zero `llm/` import, since `PlayClient.tsx` rebuilds
chips client-side on reload — an interface method on the `llm/`-side
`CombatSystem` would need a parallel shared-side dispatcher anyway, so the
extra interface surface would be dead weight). The route needed no new body
field, confirmed by inspection rather than a dedicated round-trip test (the
existing `combatAction` parse path is generic over `CombatActionSpec`, which
already carries `alloc`). 8 new tests (4 turnPlan `"allocate"` accept/reject/
cap/range, 4 `combat.test.ts` dispatcher-by-system + a defensive classic
fallback when `combat.ship2` is unexpectedly absent). Verified: dev server
boots clean, homepage loads with zero console errors — a full ship2-fight
click-through wasn't run (reaching one needs a live campaign + a ship
encounter, out of proportion to script safely here); the round-resolution
math itself is covered exhaustively by Tasks A/B's 102 unit/integration
tests, which is where this project's combat work has consistently drawn its
confidence from rather than manual browser sessions.*

1. `shared/turnPlan.ts`: `CombatActionSpec.type` gains `"allocate"`, plus
   optional `alloc` (zod mirror of `Allocation`, all fields bounded:
   `mounts` max 4 strings, `shields`/`engines` 0-6). `MemberOrderSpec`
   untouched (ground only).
2. Route (`app/api/turn/route.ts`): no new body field — `combatAction`
   already carries the whole spec. Verify the zod extension round-trips
   through `lastChoices` persistence (chips store `combatAction` verbatim).
3. Chip dispatch: `CombatSystem` gains `chips(combat, consumables,
   burstReady, weapons)` (the slice-2 interface addition the seam annotated).
   Classic wraps the existing `combatActions`; ship2 wraps `ship2Presets`.
   Switch the three chip call sites (`combatTurn.ts` ~144, route ~716,
   `PlayClient.tsx` ~148) to a shared scale/system-aware helper
   (`combatChipsFor(combat, …)` in `shared/combat.ts` — client-safe, trap 4;
   it dispatches on `combat.system`, NOT via the llm/ registry).
4. `PlayClient.tsx`: a compact **PowerPanel** rendered when
   `combat?.active && combat.system === "ship2"` — remaining-power readout,
   a toggle per mount, steppers for shields/engines (respecting caps from
   `combat.ship2.player`), target picker when >1 enemy lives, overcharge
   toggle when a beam lance is mounted, and a **Commit power** button that
   `send()`s the composed `allocate` action. Preset chips remain the one-tap
   path (they're ordinary choices). Reuse the crew-chip styling; modest.
5. Tests: zod accepts a well-formed allocate chip and rejects an oversized
   one; `validateAllocation` clamps an overspent/foreign-mount payload
   (the engine-side guard, trap 6).

*Review (Phase 3, 2026-07-18) — two defects found, both fixed forward:
(1) **Rounds were sequential, not simultaneous-reveal.** The player's damage
landed first and `finishShip2Round` filtered `hp > 0` before the enemy volley
— a wrecked ship never fired its dying volley, killing the last enemy skipped
return fire entirely, and mutual destruction (this doc's explicit "apply
damage to BOTH sides regardless of what dies; mutual = disabled" rule, and an
owner-resolved COMBAT_V2.md decision) was unreachable; the promised
mutual-kill test correspondingly didn't exist. Fixed: the firing set is
frozen at round start (`firingIds`) before player damage applies, and
outcomes resolve only after both volleys — hull-0 FIRST (mutual destruction =
disabled, no salvage), then victory. (2) **Task B step 4 (typed-text mapping)
was silently skipped** — typed "fire on the corvette" reached ship2 as a
classic `{attack, enemyId}` whose named target the fallback DISCARDED
(retargeting first-alive), and "evasive maneuvers" (`{cover}`) triggered the
all-guns default, the opposite intent. Fixed at the consumption end rather
than adding a parallel keyword branch to `interpretCombatText` (one parser,
two consumers): `resolveShip2Round` now maps `attack` → default spread AT the
named target and `cover` → defensive posture (hold fire, shields+engines max);
the no-order fallback became a bare `allocate` so it still lands on
guns+shields per this doc's never-stall rule. 4 net new tests (dying volley +
mutual-kill→disabled-no-salvage + named-target + cover-defensive; the old
"stray action" test now uses `aim`). 965 total, `tsc` clean, golden
untouched. Verified clean in review: the allocation clamp is engine-side and
re-validated per round (a crafted payload can't overspend/fire unowned/dry
mounts — tested); guards stayed at the dispatcher/start layer (fate recording
unreachable-to-skip, spawn clamps untouched); jsonb spread order lets a
stored `ship2` system win on load; `combatChipsFor`'s registry bypass is the
right call for client rebuildability. Noted, no fix: a ship with two
same-type weapons collapses to one mount (dedupe by id — no multi-weapon
ships exist; slice 3's slots will model this properly), and the defensive
classic-chips fallback for a `system:"ship2"` state missing its `ship2` slice
routes clicks into ship2's bail-out (frees the fight as "escaped" — an
acceptable dead-man's switch for a state that can't occur).*

## Task D — docs + close-out

- `COMBAT_V2.md`: Part B shipped-note; CORRECT the counter-triangle line
  ("spray beats shields, punch beats armor, evasion beats spray" → the
  mechanically consistent triangle from this doc) with a one-line why.
- `CHECKS.md`: §0 row for the allocation clamp (client payload → engine
  re-validation) and a §2-family note that ship2 keeps fate recording
  dispatcher-level.
- `STATUS.md` item 0 + `CLAUDE.md` docs map; annotate THIS handoff per
  WORKFLOW.md Phase 2 as you go.

## Explicitly OUT of scope

Customization slots + market/dock install (slice 3); charge banking + called
shots (slice 4); boarding; per-mount targeting; clickable crew station
reassignment; ship2 for the tutorial/prologue (STORY.md slice); any Ship
schema/DB change; rebalancing ground combat; migrating old ¢ call sites.

## Definition of done

- `tsc` clean; full suite green (877 baseline + new); golden BYTE-IDENTICAL
  (nothing touches prompts; `combatTurn`'s narration contract is unchanged —
  it narrates engine lines, whatever system produced them).
- Live-data check: `campaign_runtime where combat is not null` — any
  mid-flight CLASSIC ship fight must still resolve (it will: `system` field);
  expect zero rows anyway.
- A manual dev-server round: start a ship fight (typed or via a travel
  encounter), allocate from the panel AND from a preset chip, confirm the
  round lines read clean and hull/salvage flow works.
- One commit per task; annotate this handoff per WORKFLOW.md Phase 2.
