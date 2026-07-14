# ITEMS.md — Item Audit, Consumables & Inventory Design

*Consumables (catalog + combat use) and loot drops are **shipped**. Remaining:
inventory slots (B), ammo spend / reload economy (D), shops — buying + selling
(E). This doc holds the design for those three plus the catalog context they
build on.*

---

## Catalog context (shipped, for reference)

`content/items.json` — every mechanical item has an id, type, slot cost, price
band, and an **effect the engine executes**. Consumable effects and combat use
are live; item **gains** are gated to a legitimate source (a loot roll —
`engine/loot.ts` generates tier-appropriate salvage on a successful loot/scavenge
check — or a quest reward). Players can't author their own items.

### Consumables — personal (shipped)
| Item | Effect (engine) | Combat use |
|---|---|---|
| Stim | heal **1d6+2**, 1/round | yes (instant) |
| Medkit | heal **2d6+2**; can clear `Downed` (stabilize) | out-of-combat / medic role in combat |
| Frag grenade | **2d6 to every enemy** (personal scale), one throw | yes (replaces attack) |
| Smoke charge | next **flee auto-succeeds** | yes |
| Breach charge | auto-success on one forced-entry check (doors/hulls/locks) | situational |

### Consumables — ship
| Item | Effect (engine) | Combat use |
|---|---|---|
| Shield cell | restore `shieldReady` mid-fight | yes (ship) |
| Hull patch kit | ship heal **1d6+2**, out of combat | no |
| Missile reload | +2 missiles | no (dock only) — see ammo economy (D) |

### Non-consumable
- **Weapons/armor**: existing `damage`/`acBonus` gear, with catalog ids, slot
  costs, and prices so they can be bought/sold/looted.
- **Tools** (scanner, black book, vac suit …): flavor + occasional situational
  bonus via `detail`; zero engine effect (narrative hooks).
- **Cargo**: quest/trade items; occupy ship hold, not personal slots (hold is
  narrative until the trade loop lands formal hold slots).

---

## Remaining — B. Inventory space (activate the dormant `slots`/`maxSlots` fields)

- `maxSlots = 6 + might` (recomputed like HP at creation; retrofit via a one-time
  backfill for existing characters).
- Slot costs: weapon 2 (sidearm 1), armor 2, tool 1, consumable 1 per stack.
  **Consumables stack ×3 per slot** (3 stims = 1 slot).
- Full inventory ⇒ acquisition offers become swap choices ("drop X to take Y?") —
  engine-generated chips, never silent loss.
- The `stims` counter migrates into a normal catalog stack ("Stim ×2" in gear);
  the field stays for back-compat but the catalog is the source of truth.
- UI: Status tab inventory becomes slot-aware — `Inventory 7/9` + stack badges.

## Remaining — D. Ammo spend / reload economy

- Missiles (and any future ammo-bearing weapon) are consumed on use; the engine
  debits ammo when a firing action resolves, never narratively.
- Reload is a purchase, not free: **Missile reload +2** at a dock (price ~2×
  `missileCost`), gated to dock/market access — no field reload.
- Ties into shops (E): reload stock is part of a market's tier-appropriate subset.

## Remaining — E. Shops / markets (the credit sink)

- Stations with a `market` tag sell a tier-appropriate subset at catalog price
  (±20% by local rep). Buying is a choice chip → engine debits credits, adds
  item. This is the missing **credit sink** (credits currently have few sinks).
- Selling: the inverse — offload looted/unwanted gear for credits (band below buy
  price).
- Pricing rule (from ECONOMY.md E-3): **dock repair (¢12/HP) is always the
  efficient option**; the hull patch kit (~¢14.5/HP) is the field-emergency
  premium for when you can't reach a dock. Docks also extend credit — repair can
  push the balance negative, spawning a dock-debt payoff job rather than a
  soft-lock.

## Usage flow (engine-owned — shipped for consumables, same contract for the rest)

- Out of combat: item-use is a choice chip or free text the model maps to
  `TurnPlan.useItem: { itemId }`; the **engine** validates possession, applies the
  effect, emits the system line (`🩹 Medkit: +9 HP — 3→12`), decrements.
- In combat: usable items appear as engine-generated combat actions (Use stim /
  Throw grenade / Pop smoke) — no model involvement.
- An effect never happens twice (idempotent per turn) and never narratively-only.

## ⚠ Flags (governing the remaining slices)

- **IT-1 legacy gear mapping**: existing campaigns hold freeform gear names. Map
  by fuzzy name match where obvious (e.g. "Stimpack"), else leave as zero-effect
  flavor items occupying their listed slots. No silent deletion.
- **IT-2 slot retrofit**: adding maxSlots to live characters may put some over-cap
  on day one → grandfather: over-cap is allowed but blocks NEW pickups until under.
- **IT-4 economy pressure**: prices are guesses; keep them in content JSON and
  tune from play data (same policy as crew wages, C-1).
- **IT-5 stims-field back-compat**: engine paths that read `character.stims`
  (`adjust_resource "stims"`) must keep working during the slot migration window.
