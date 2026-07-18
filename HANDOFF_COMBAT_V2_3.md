# HANDOFF — Combat V2 slice 3: ship customization (slots + shipyard + install)

*Strategy phase output (Fable, 2026-07-18). Read `WORKFLOW.md` first, then this
doc fully. Design source: COMBAT_V2.md "Customization (the Eclipse joy)".
Predecessors: `HANDOFF_COMBAT_V2_1.md`, `HANDOFF_COMBAT_V2_2.md` (both shipped
— ship2 is live; this slice makes loadout the build game it was priced for).*

## Context

Ship2 (slice 2) derives the player's combat profile from the EXISTING `Ship`
row at fight start — `weapons[]` types map to mounts, `hasShield`/
`damageReduction`/`evasiveAcBonus`/`hasPointDefense` map to defenses. That
derivation is this slice's payoff seam: **customization = writing into those
same fields**, and the next fight simply derives a better ship. Buy a beam
lance → `weapons[]` gains an energy entry → the profile grows a beamLance
mount. No new combat code; the build game rides what slice 2 already reads.

**The one structural decision (locked): NO Ship schema change, NO migration.**
The `ships` table is column-backed (`weapons` jsonb + the system booleans/
ints), persisted by `saveCampaignState`'s upsert — mutations stick with zero
new plumbing. The design doc's "existing ship fields become systems in slots"
means slots are an ACCOUNTING layer (pack-defined caps + helpers that count
what's fitted), not a new storage shape. Slice-4+ can revisit if charge
banking needs real per-mount state.

## ⚠ THE TRAPS for this handoff

1. **Ships are NOT campaign_runtime jsonb.** They're a column-backed table
   loaded through `Ship.parse(fromRow(...))` — a REAL Zod parse. No load-time
   normalization needed for anything this slice writes (it only writes fields
   that already exist). Do not add a migration; do not add Ship fields.
2. **Engine-side validation, always** (the allocation-clamp precedent, CHECKS
   §0): a shipyard chip is a PROPOSAL. `buyShipItem`/`sellShipItem` must
   re-check market presence, tier, slots, price, and ownership of the thing
   being sold — a stale/crafted chip must fail with a line, never corrupt.
3. **Don't touch `promptSections/`** — nothing here needs prompt context, and
   the golden is byte-pinned. The narrator learns about a refit from the
   engine line, like every purchase today.
4. **Classic combat reads these same fields** (`weapons[0]`, `evasiveAcBonus`,
   `damageReduction`, …). That's CORRECT — a refit should improve a legacy
   in-flight classic fight too — and safe: markets need a dock, so no
   purchase can land mid-fight; and ship2's in-fight profile is frozen at
   fight start regardless.
5. **New engine lines use `shared/lexicon.ts`** (`fmtCredits`).
6. **Task A first.** Multi-mount ships make the known duplicate-mount-id
   defect real (two kinetic weapons currently collapse into one usable
   railgun — noted in slice 2's review). Fix it before anything can sell a
   second cannon.

---

## Decision-final numbers (tune later via pack edits only)

**Slot caps** (new required fields on `PackShip2Class` — update all five):

| class | mountSlots | systemSlots |
|---|---|---|
| scout | 1 | 2 |
| fighter | 2 | 2 |
| hauler | 2 | 3 |
| gunship | 3 | 3 |
| corvette | 4 | 4 |

Slots may EXCEED what the reactor can fire in one round — intentional and
self-balancing: power is the per-round constraint, slots are the collection
you choose from each round. (A hauler with two guns still fires one per
round on reactor 3; the second gun buys per-round CHOICE, not raw output.)

**Mount items** (`outfitting.mountItems` — buying appends a `weapons[]`
entry with the given type/damage; damage strings align with weapons.json's
shipScale sketches and feed CLASSIC fights + flavor; ship2 cares only about
the type→profile map):

| id | name | type → ship2 mount | damage | price | tier |
|---|---|---|---|---|---|
| kineticCannon | Kinetic cannon | kinetic → railgun | 2d6 | ¢250 | T1 |
| ionBattery | Ion battery | ion → autocannon | 1d6 | ¢400 | T2 |
| beamLance | Beam lance | energy → beamLance | 2d6 | ¢450 | T2 |
| missileRack | Missile rack | missile → missileRack | 3d8 (ammo 4) | ¢550 | T3 |

**System items** (`outfitting.systemItems` — buying SETS the existing Ship
field; buying one already fitted errors "already fitted"; each fitted system
occupies one system slot):

| id | name | Ship field written | price | tier |
|---|---|---|---|---|
| hullPlating | Hull plating | `damageReduction = 1` | ¢350 | T1 |
| vectorThrusters | Vector thrusters | `evasiveAcBonus = 2` | ¢300 | T2 |
| shieldEmitter | Shield emitter | `hasShield = true` (+`shieldReady`) | ¢400 | T2 |
| pointDefense | Point-defense grid | `hasPointDefense = true` | ¢450 | T2 |
| burstDrive | Burst drive | `burstDriveReady = true` | ¢500 | T3 |

Rules:
- **Buy = install in one step** at a docked market (`marketTierFor` gates,
  same as items/repair; ship must be present). No inventory limbo. Price uses
  the SAME `repPriceFactor` + engine-haggle 10% the item till uses.
- **Sell = strip** at the flat `SELL_RATE` (40%) of catalog price. Selling a
  mount removes that `weapons[]` entry; selling a system unsets its field. A
  legacy/freeform weapon with no catalog match values by its TYPE's mount
  item (unknown type → kineticCannon's price).
- **Burst drive is a one-shot**: using it in a fight already sets
  `burstDriveReady = false` — that's the charge spent and the SLOT freed;
  re-buying re-arms. (A persistent-drive-that-recharges is a later slice.)
- **Buying a mount needs a free mount slot** (`weapons.length < mountSlots`);
  when full, the player sells first — no swap-combo chips this slice.
  Duplicates are ALLOWED (two kinetic cannons = two railgun mounts; Task A).
- **Stock materialization**: a ship with EMPTY `weapons[]` derives its class
  default mounts today. The FIRST install on such a ship first writes those
  class defaults into `weapons[]` as real entries (name from the mount item
  of that type, class-table damage), THEN applies the purchase if a slot
  remains — so buying never silently deletes the stock guns the player has
  been firing. Pure helper `materializeStockWeapons(ship)`, tested.
- **Shelf**: full tier-gated list, deterministic, NO 30-day rotation — ship
  hardware is a destination purchase; rotating it would just frustrate.
- **Net worth intentionally unchanged this slice**: `netWorth` keeps valuing
  the hull by class only. Installed hardware raising the threat band would
  force retuning COMBAT.md §1 — out of scope; note it in the shipped-note.

---

## Task A — mount-instance keys (the multi-mount fix)

`Ship2MountInstance` gains `key: string`, unique per ship — the profile id
plus an ordinal for repeats (`"railgun"`, `"railgun-2"`), assigned in
`weapons[]` order by `deriveShip2Profile`; keep `id` as the catalog-profile
id. Everything that today references a mount by `id` switches to `key`:

- `Allocation.mounts` holds KEYS. `validateAllocation` dedupes by key (two
  railguns both fire), costs by the instance's profile.
- `resolveShip2Round`: mount lookups by key; the overcharge first-match rule
  operates on keys; **missile ammo decrements ONLY the fired instance's own
  `weapons[]` entry** — add `weaponIndex?: number` to the instance so the
  decrement stops hitting every missile weapon at once (a second latent bug
  this fixes). `defaultShip2Allocation` emits keys.
- `ship2Presets` + the PowerPanel toggle on `key` (label stays `name`);
  `firableMounts`/dry-rack checks per instance.
- Enemy side: class-default mounts are distinct per class, so enemy keys ==
  ids naturally — `deriveEnemyShip2Profile` just fills `key = id`.
- `AllocationSpec.mounts` cap rises to 6 (mountSlots max 4 + headroom).

**Tests:** a ship with two kinetic weapons derives two railgun instances and
fires BOTH in one allocation (damage ≈ 2× one); ammo decrement hits only the
fired rack when two missile racks are carried; existing suite green (single-
mount ships behave identically — keys equal ids there).

## Task B — the outfitting catalog + pure helpers

1. Pack (`content/pack/drift/ship2.ts` + `PackShip2` zod in
   `content/pack/types.ts`): add `mountSlots`/`systemSlots` to every class
   row (required fields), and a new `outfitting: { mountItems, systemItems }`
   per the tables above (typed records; `systemItems[].field` is a literal
   union of the five system effects). `validatePack` + `pack.test.ts`:
   every mountItem's type maps to a real mount profile; every class's
   `mountSlots >= its default mounts.length`; prices positive; tiers valid.
2. `shared/ship2.ts` (client-safe) helpers, all pure + tested:
   - `shipMountSlots(ship)` / `shipSystemSlots(ship)` → `{ used, cap }`
     (used mounts = `weapons.length`, or the class default count when
     `weapons[]` is empty; used systems = count of fitted fields, spent
     burst drive NOT counted).
   - `materializeStockWeapons(ship)` → `Ship` (idempotent on non-empty).
   - `shipyardStock(state)` → `{ mounts: […], systems: […] }` with per-item
     `{ id, name, price, canBuy, reason? }` — tier/slot/already-fitted logic
     lives HERE so the chips layer and the runtime share one truth.

## Task C — buy/sell runtime + protocol + chips

1. `llm/runtimeEconomy.ts`: `buyShipItem(rt, itemId)` and
   `sellShipItem(rt, ref)` (ref = a mount KEY or weapon name, or a system
   id — lenient match, `sellItem` precedent). Re-validate everything
   (trap 2); mutate `rt.state.ship`; debit/credit the PC; engine line via
   `fmtCredits` (`🔧 Beam lance fitted — −¢450.` / `🔧 Stripped the ion
   battery — +¢160.`). Expose as `TurnRuntime` methods (engineBridge).
2. Protocol: route params `buyShipItem`/`sellShipItem` (string, same
   pattern as `buyItem`) → `jsonTurn` `preBuyShip`/`preSellShip` →
   runtime call, exactly where `preBuy`/`preRepair` apply today.
   `ChoiceOption` (shared/turnPlan.ts) gains both fields (optionalNullable
   strings) so chips persist through `lastChoices`.
3. Chips: `shipyardChips(state)` in `shared/ship2.ts` — shown from the
   route's shopping-intent block (route ~749, beside `marketChips`) when
   docked + ship present: affordable installs (`Install beam lance — ¢450`)
   + strip chips for fitted hardware (`Strip ion battery — +¢160`), capped
   ~6 total like the market. One `chipKinds.ts` registry entry (🔧) so
   PlayClient needs zero edits.
4. **Tests:** buy happy path writes the ship + debits; slot-full buy errors;
   above-tier errors; already-fitted system errors; sell strips + refunds
   40%; job-agnostic (ships carry no jobId — n/a); first-install
   materializes stock; haggle + rep pricing applied; chips reflect
   `canBuy`/`reason`; zod round-trip of the two ChoiceOption fields.

## Task D — loadout display + docs

1. `components/sidebar/ShipTab.tsx`: a Loadout block — mounts (name, profile
   label, ammo where limited) and systems (fitted list), each with
   `used/cap` slot lines. Read-only; the shipyard chips are the interaction.
2. Docs: COMBAT_V2.md "Customization" shipped-note (include the net-worth
   deferral + burst-drive-as-one-shot notes); STATUS.md item 0 + test count;
   CHECKS.md §0 row for the shipyard's engine-side re-validation; annotate
   THIS handoff per WORKFLOW.md Phase 2 as you go.

## Explicitly OUT of scope

Charge banking + called shots (slice 4); swap-combo chips; ship SALES/hull
purchases (changing `shipClass`); loaner repossession mechanics; counting
installed hardware in net worth; recharging burst drives; per-faction
shipyard flavor; M2 migration of old ¢ lines.

## Definition of done

- `tsc` clean; full suite green (965 baseline + new); golden BYTE-IDENTICAL.
- No DB migration exists in the diff (trap 1 — its absence is the check).
- A manual dev-server pass: dock somewhere with a market, type "browse the
  shipyard", install something, see it in ShipTab, start a ship fight and
  confirm the new mount appears in the PowerPanel.
- One commit per task; annotate this handoff per WORKFLOW.md Phase 2.
