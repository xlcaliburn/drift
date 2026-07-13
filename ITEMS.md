# ITEMS.md — Item Audit, Consumables & Inventory Design

*Spun off from COMBAT.md review round 1 (I-6). Status: draft for review.*

---

## 1. Audit — what items are today

- `GearItem` is freeform flavor: `{ name, detail?, damage?, acBonus? }`. Only
  `damage` (weapons) and `acBonus` (armor, applied at creation) do anything.
- `stims` is a bare counter on Character with **no defined effect anywhere**.
- `Character.slots` / `maxSlots` exist in the schema and DB but are **unused**.
- Ships carry weapons/ammo (missiles) — already mechanical.
- No shops, no loot items, no consumable effects. Credits have few sinks
  (dock fees, wages) — one reason money feels flat.

**Conclusion:** we don't have an item *system*, we have labels. The fix is a
small typed catalog with engine-executed effects, not more prose.

## 2. Catalog (versioned content JSON, like weapons/matrix)

`content/items.json` — every mechanical item has an id, type, slot cost, price
band, and an **effect the engine executes**. The starter catalog (deliberately
small and diverse — one item per job):

### Consumables — personal
| Item | Effect (engine) | Combat use | Price ~ |
|---|---|---|---|
| Stim | heal **1d6+2**, 1/round | yes (instant) | 30¢ |
| Medkit | heal **2d6+2**; can clear `Downed` (stabilize) | out-of-combat / medic role in combat | 75¢ |
| Frag grenade | **2d6 to every enemy** (personal scale), one throw | yes (replaces attack) | 60¢ |
| Smoke charge | next **flee auto-succeeds** | yes | 45¢ |
| Breach charge | auto-success on one forced-entry check (doors/hulls/locks) | situational | 50¢ |

### Consumables — ship
| Item | Effect (engine) | Combat use | Price ~ |
|---|---|---|---|
| Shield cell | restore `shieldReady` mid-fight | yes (ship) | 90¢ |
| Hull patch kit | ship heal **1d6+2**, out of combat | no | 80¢ |
| Missile reload | +2 missiles | no (dock only) | 102¢ (2× missileCost) |

> Pricing rule (ECONOMY.md E-3): **dock repair (¢12/HP) is always the efficient
> option**; the patch kit (~¢14.5/HP) is the field-emergency premium for when
> you can't reach a dock. Docks also extend credit — repair can push the
> balance negative, spawning a dock-debt payoff job rather than a soft-lock.

### Non-consumable
- **Weapons/armor**: existing `damage`/`acBonus` gear, now with catalog ids,
  slot costs, and prices so they can be bought/sold/looted.
- **Tools** (scanner, black book, vac suit …): flavor + occasional situational
  bonus via `detail`; zero engine effect in v1 (they stay narrative hooks).
- **Cargo**: quest/trade items; occupy ship hold, not personal slots (v1: hold
  is narrative; formal hold slots come with the trade loop later).

## 3. Inventory space (activate the dormant fields)

- `maxSlots = 6 + might` (recomputed like HP at creation; retrofit via a
  one-time backfill for existing characters).
- Slot costs: weapon 2 (sidearm 1), armor 2, tool 1, consumable 1 per stack.
  **Consumables stack ×3 per slot** (3 stims = 1 slot).
- Full inventory ⇒ acquisition offers become swap choices ("drop X to take
  Y?") — engine-generated chips, never silent loss.
- The `stims` counter migrates into a normal catalog stack ("Stim ×2" in gear);
  the field stays for back-compat but the catalog is the source of truth.

## 4. Acquisition & the credit sink

- **Shops**: stations with a `market` tag sell a tier-appropriate subset at
  catalog price (±20% by local rep). Buying is a choice chip → engine debits
  credits, adds item. This is the missing **credit sink**.
- **Loot**: combat victory (COMBAT D-8) can drop catalog items (tier-weighted
  small table) alongside clamped credits.
- **Rewards**: quest payouts may name catalog items (engine-granted).

## 5. Usage flow (engine-owned, like everything else)

- Out of combat: item-use is a choice chip or free text the model maps to
  `TurnPlan.useItem: { itemId }`; the **engine** validates possession, applies
  the effect, emits the system line (`🩹 Medkit: +9 HP — 3→12`), decrements.
- In combat: usable items appear as engine-generated combat actions (Use stim /
  Throw grenade / Pop smoke) — no model involvement at all.
- An effect never happens twice (idempotent per turn) and never happens
  narratively-only.

## 6. UI

- Status tab inventory becomes slot-aware: `Inventory 7/9` + stack badges.
- Combat action chips show consumable counts (`Stim ×2`).

## 7. Build order

**Items v1 rides right behind combat v1** (combat needs stim/grenade/smoke to
make round choices interesting) and before CREW (medkit vs medic overlap is
intentional: medkit is the solo player's medic).

V1 cut line: catalog + slots + consumable effects + combat actions + loot
drops. **Shops/markets can be v1.5** if scope needs trimming — loot alone
exercises the whole item pipeline.

## ⚠ Flags

- **IT-1 legacy gear mapping**: existing campaigns hold freeform gear names.
  Map by fuzzy name match where obvious (e.g. "Stimpack"), else leave as
  zero-effect flavor items occupying their listed slots. No silent deletion.
- **IT-2 slot retrofit**: adding maxSlots to live characters may put some
  over-cap on day one → grandfather: over-cap is allowed but blocks NEW pickups
  until under.
- **IT-3 grenade + halt rule**: AoE that downs the *last* enemy interacts fine,
  but grenade vs a mixed fight where crew are engaged (CREW.md) needs a
  friendly-fire decision — v1: no friendly fire (chaos tax later, maybe).
- **IT-4 economy pressure**: prices are guesses; keep them in content JSON and
  tune from play data (same policy as crew wages, C-1).
- **IT-5 stims-field back-compat**: engine paths that read `character.stims`
  (adjust_resource "stims") must keep working during the migration window.
