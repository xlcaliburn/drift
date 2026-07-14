# ITEMS.md — Item Audit, Consumables & Inventory Design

*ALL SLICES SHIPPED (2026-07-14): consumables + loot, weapon/armor catalog (W),
inventory slots (B), ammo/reload gating (D), shops (E). This doc is now the
reference for how the item system works. Remaining polish: engine-generated
swap chips on a full pack (v1 blocks with a visible line instead); dock repair
credit/debt (ECONOMY E-3) is still unbuilt.*

## Locked decisions (2026-07-14)

- **No per-shot personal ammo.** The `rounds` field stays dormant; missiles are
  the only tracked ammo (already debited on fire, gated when dry).
- **Sell rate: flat 40%** of value (catalog price, else the netWorth gear
  heuristic). No rep scaling on sales; rep scales BUY prices only (±20%).
- **Stock rotates every 30 in-game days** — seeded per (location, 30-day chunk),
  so two players at the same station in the same window see the same shelves.
- **Top-end gear is market-gated.** Every catalog weapon/armor has a
  `marketTier`; a market only shelves items at/below its own tier (blackmarket
  T3 > commerce T2 > backwater T1). The best guns aren't for sale at a
  backwater dock — this keeps the net-worth enemy-scaling ratchet honest
  (COMBAT.md §1): you buy up, your net worth crosses a band, tougher enemies
  unlock.

## Slice W — weapon/armor/tool catalog (foundation for B/E)

- Add weapons/armor/tools to `content/items.json`: id, price, `damage`/`acBonus`,
  slot cost, `marketTier`. Prices calibrated so a fresh loadout + ¢120 stays
  UNDER the ¢600 T2 net-worth cutoff.
- **Legacy mapping (IT-1)** via an alias table: freeform creation-gear names
  ("Heavy plate", "Riot gun", "Hunting rifle") attach an `itemId` on session
  load; the display name is preserved, the id brings price/slot data. Unmatched
  gear stays zero-effect flavor. netWorth then uses real prices.
- AC from armor = the BEST single piece (no vest-stacking), recomputed by the
  engine whenever armor is gained/lost/sold.

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

- `maxSlots = 8 + might`, computed live by a helper (no DB backfill needed —
  the stored fields are ignored). *(Deviation from the original 6+might: a fresh
  loadout uses ~6 slots, so 6+might would start most characters full.)*
- Slot costs come from the catalog (`slot` field); flavor gear: weapon 2
  (light 1), armor 2, else 1. **Consumables stack ×3 per slot** (3 stims = 1 slot).
- Full inventory ⇒ the gain is blocked with a visible line ("Inventory full —
  X left behind; drop something first"), never silent loss. Engine-generated
  swap chips are the polish pass, not v1.
- The `stims` counter migrates into a normal catalog stack ("Stim ×2" in gear);
  the field stays for back-compat but the catalog is the source of truth.
- UI: Status tab inventory becomes slot-aware — `Inventory 7/9` + stack badges.

## Remaining — D. Ammo spend / reload economy

- Missiles only (locked: no per-shot personal ammo). Firing debit + dry gating
  are SHIPPED; what's left is the purchase gate — **Missile reload +2** is
  bought at a market (price ~2× `missileCost`), part of slice E's stock.

## Remaining — E. Shops / markets (the credit sink)

- Market tier from location tags: `blackmarket` → T3 shelves, `commerce` → T2,
  `hazard`/`hidden` → no market, anything else → T1 basics.
- Stock = all consumables + a seeded, rotating (30-day chunk) pick of
  weapons/armor/tools at/below the market's tier. Deterministic per
  (location, chunk): shared canon shelves.
- Buy at catalog price ±20% by local controlling-faction rep; the engine
  validates stock/credits/slots, debits, adds gear. New TurnPlan fields
  `purchase: {itemId, qty?}` / `sell: {name}` — the model narrates the counter,
  the ENGINE prints every figure (same contract as offers/payouts).
- A `MARKET HERE` context block lists the actual shelves so the AI can only
  sell what exists.
- Selling: flat 40% of value (catalog price, else the netWorth heuristic).
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
