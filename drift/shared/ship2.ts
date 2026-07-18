import type { Character, Ship, CampaignState } from "./schemas";
import type { UsableConsumable } from "./items";
import type { CombatAction } from "./combat";
import { ship2 as ship2Catalog } from "@/content";
import { marketTierFor, repPriceFactor, localRep, SELL_RATE } from "@/engine/market";
import { fmtCredits } from "./lexicon";

/**
 * Client-safe ship2 types + pure helpers (COMBAT_V2.md Part B, HANDOFF_COMBAT_V2_2.md
 * Task A) — profile derivation, allocation clamping, and preset chips. No `llm/`
 * import here: `PlayClient.tsx` rebuilds combat chips on reload (the seam's trap 4),
 * so everything the client needs to render/validate an allocation lives in shared/.
 */

export interface Ship2MountInstance {
  /** Catalog mount id (railgun/autocannon/beamLance/missileRack) — shared by
   *  every instance of that profile; NOT unique when a ship carries two of
   *  the same mount (HANDOFF_COMBAT_V2_3 Task A — the multi-mount fix). */
  id: string;
  /** Unique per ship: the profile id, or `${id}-2`/`${id}-3`/… for repeats
   *  (assignMountKeys, in ship.weapons[] order). Allocations/lookups key on
   *  THIS, never `id` — two railguns must be independently fireable. */
  key: string;
  name: string;
  power: number;
  dice: number;
  hitOn: number;
  dmgPerHit: number;
  overchargeHitOn?: number;
  ammoLimited?: boolean;
  pdHitOn?: number;
  /** Player-side ammo-limited mounts read live off `ship.weapons[].ammo`; an
   *  undefined ammo on a non-ammo-limited mount means "unlimited". */
  ammo?: number;
  /** The `ship.weapons[]` index this instance derives from (player ships
   *  only) — lets the ammo decrement hit ONLY the fired rack, not every
   *  missile weapon the ship carries. Undefined for a class-default virtual
   *  mount (no real weapons[] entry backs it yet) and always for enemies. */
  weaponIndex?: number;
}

export interface Ship2Profile {
  shipClass: string;
  reactor: number;
  engineCap: number;
  shieldCap: number;
  armor: number;
  hasPointDefense: boolean;
  /** A standing gunner boosts one near-miss die per round (engine/ship2.ts's
   *  applyGunnerBoost) — a crew passive, not a spendable resource. */
  gunnerBoost: boolean;
  mounts: Ship2MountInstance[];
}

export interface Allocation {
  /** Mount KEYS fired this round (each costs its `power`, drawn from
   *  `reactor`) — `Ship2MountInstance.key`, NOT `.id` (two railguns need two
   *  distinct entries to both fire). */
  mounts: string[];
  shields: number;
  engines: number;
  /** Overcharge the ONE fired mount that supports it (+1 power, lowered hit-on) —
   *  a bool, not a mount id: only one overchargeable mount type exists this slice. */
  overcharge?: boolean;
  /** The enemy ship targeted (matters only when more than one is alive). */
  targetId?: string;
  /** A held ship consumable used this round — a free action, doesn't draw power
   *  (mirrors ground's free weapon-switch), so it rides alongside mounts/shields/
   *  engines instead of replacing them. */
  itemId?: string;
}

const WEAPON_TYPE_TO_MOUNT: Record<string, string> = {
  kinetic: "railgun",
  energy: "beamLance",
  ion: "autocannon",
  missile: "missileRack",
};

type MountCatalogEntry = {
  name: string;
  dice: number;
  hitOn: number;
  dmgPerHit: number;
  power: number;
  overchargeHitOn?: number;
  ammoLimited?: boolean;
  pdHitOn?: number;
};
type ClassCatalogEntry = { reactor: number; engineCap: number; shieldCap: number; armor: number; mounts: string[]; policy: string[] };

type MountWithoutKey = Omit<Ship2MountInstance, "key">;

function mountFromCatalog(
  mountId: string,
  nameOverride: string | undefined,
  ammo: number | undefined,
  weaponIndex?: number,
): MountWithoutKey {
  const catalog = ship2Catalog.mounts as Record<string, MountCatalogEntry>;
  const m = catalog[mountId];
  return {
    id: mountId,
    name: nameOverride || m?.name || mountId,
    power: m?.power ?? 2,
    dice: m?.dice ?? 1,
    hitOn: m?.hitOn ?? 4,
    dmgPerHit: m?.dmgPerHit ?? 1,
    overchargeHitOn: m?.overchargeHitOn,
    ammoLimited: m?.ammoLimited,
    pdHitOn: m?.pdHitOn,
    ammo,
    weaponIndex,
  };
}

/** Assign a unique `key` per mount in ship order — the profile id for the
 *  first of its kind, `${id}-2`/`${id}-3`/… for repeats (HANDOFF_COMBAT_V2_3
 *  Task A). Pure + order-stable: the same ship always keys the same way. */
function assignMountKeys(mounts: MountWithoutKey[]): Ship2MountInstance[] {
  const seen = new Map<string, number>();
  return mounts.map((m) => {
    const n = (seen.get(m.id) ?? 0) + 1;
    seen.set(m.id, n);
    return { ...m, key: n === 1 ? m.id : `${m.id}-${n}` };
  });
}

/**
 * Derive the player's ship2 profile from the EXISTING `Ship` row + the class
 * table — no schema change, no migration. Frozen into `combat.ship2.player`
 * at fight start (llm/runtimeCombat.ts's beginCombat), so mid-fight upgrades
 * never shift the numbers under a live round.
 */
export function deriveShip2Profile(ship: Ship, standingCrew: Character[]): Ship2Profile {
  const classes = ship2Catalog.classes as Record<string, ClassCatalogEntry>;
  const cls = classes[ship.shipClass];
  const rawMounts: MountWithoutKey[] = ship.weapons.length
    ? ship.weapons.map((w, i) => mountFromCatalog(WEAPON_TYPE_TO_MOUNT[w.type] ?? "railgun", w.name, w.ammo, i))
    : (cls?.mounts ?? []).map((id) => mountFromCatalog(id, undefined, undefined));
  const mounts = assignMountKeys(rawMounts);

  const hasEngineer = standingCrew.some((c) => c.crewRole === "engineer");
  const hasPilot = standingCrew.some((c) => c.crewRole === "pilot");
  const hasGunner = standingCrew.some((c) => c.crewRole === "gunner");

  return {
    shipClass: ship.shipClass,
    reactor: (cls?.reactor ?? 3) + (hasEngineer ? 1 : 0),
    engineCap: (cls?.engineCap ?? 1) + (ship.evasiveAcBonus > 0 ? 1 : 0) + (hasPilot ? 1 : 0),
    shieldCap: ship.hasShield ? Math.max(cls?.shieldCap ?? 0, 1) : 0,
    armor: ship.damageReduction > 0 ? Math.max(cls?.armor ?? 0, 1) : cls?.armor ?? 0,
    hasPointDefense: ship.hasPointDefense,
    gunnerBoost: hasGunner,
    mounts,
  };
}

/**
 * Derive an ENEMY ship's ship2 profile fresh each round — unlike the player's
 * (frozen once at fight start), an enemy has no crew passives or upgrades to
 * account for, so there's nothing to freeze; re-deriving from its spawned
 * `ship2Class`/`hasPointDefense` + live `missileAmmo` is just as cheap as
 * reading a stored copy and can't drift out of sync with the enemy's own
 * mutable ammo count.
 */
export function deriveEnemyShip2Profile(shipClass: string, hasPointDefense: boolean, missileAmmo: number | undefined): Ship2Profile {
  const classes = ship2Catalog.classes as Record<string, ClassCatalogEntry>;
  const cls = classes[shipClass];
  // Class mount lists have no repeats today, so keys land equal to ids —
  // assignMountKeys stays the ONE keying rule (not duplicated per side).
  const mounts = assignMountKeys(
    (cls?.mounts ?? []).map((id) => mountFromCatalog(id, undefined, id === "missileRack" ? missileAmmo ?? 0 : undefined)),
  );
  return {
    shipClass,
    reactor: cls?.reactor ?? 3,
    engineCap: cls?.engineCap ?? 1,
    shieldCap: cls?.shieldCap ?? 0,
    armor: cls?.armor ?? 0,
    hasPointDefense,
    gunnerBoost: false,
    mounts,
  };
}

/** This shipClass's deterministic allocation weights (engine/ship2.ts's
 *  resolvePolicyAllocation resolves them token-by-token). */
export function ship2ClassPolicy(shipClass: string): ("guns" | "shields" | "engines")[] {
  const classes = ship2Catalog.classes as Record<string, ClassCatalogEntry>;
  return (classes[shipClass]?.policy as ("guns" | "shields" | "engines")[]) ?? ["guns"];
}

/**
 * Clamp a (possibly client-crafted) allocation to what this profile can
 * actually afford — NEVER throws; drops what doesn't fit, in mounts→
 * shields→engines order (trap 6: the engine never trusts the client's raw
 * numbers). A dry ammo-limited mount can't be fired. Overcharge is granted to
 * the first requested, still-affordable mount that supports it; if the extra
 * +1 power doesn't fit, the mount still fires at its base profile rather than
 * being dropped outright.
 */
export function validateAllocation(profile: Ship2Profile, alloc: Allocation): Allocation {
  const byKey = new Map(profile.mounts.map((m) => [m.key, m]));
  let remaining = Math.max(0, profile.reactor);
  const mounts: string[] = [];
  let overcharged = false;

  for (const key of alloc.mounts ?? []) {
    if (mounts.includes(key)) continue;
    const m = byKey.get(key);
    if (!m) continue;
    if (m.ammoLimited && (m.ammo ?? 0) <= 0) continue;
    const wantsOvercharge = !!alloc.overcharge && !overcharged && m.overchargeHitOn !== undefined;
    const cost = m.power + (wantsOvercharge ? 1 : 0);
    if (cost <= remaining) {
      remaining -= cost;
      mounts.push(key);
      if (wantsOvercharge) overcharged = true;
    } else if (wantsOvercharge && m.power <= remaining) {
      // Can't afford the overcharge premium — still fire it at base profile.
      remaining -= m.power;
      mounts.push(key);
    }
  }

  const shields = Math.max(0, Math.min(Math.floor(alloc.shields ?? 0), profile.shieldCap, remaining));
  remaining -= shields;
  const engines = Math.max(0, Math.min(Math.floor(alloc.engines ?? 0), profile.engineCap, remaining));
  remaining -= engines;

  return { mounts, shields, engines, overcharge: overcharged, targetId: alloc.targetId, itemId: alloc.itemId };
}

export interface Ship2PresetChip {
  label: string;
  combatAction: CombatAction;
}

const firableMounts = (profile: Ship2Profile) => profile.mounts.filter((m) => !m.ammoLimited || (m.ammo ?? 0) > 0);

/**
 * Engine-generated ship2 chips — ~4 presets covering the core tradeoffs (all
 * guns / guns+shields / evasive precision strike / hold back and run silent),
 * plus a chip per held ship consumable and a flee chip. The allocation panel
 * (PlayClient.tsx) is the fine-grained alternative; these are the one-tap path.
 */
export function ship2Presets(
  profile: Ship2Profile,
  enemies: { id: string; name: string }[],
  consumables: UsableConsumable[],
  burstReady = false,
): Ship2PresetChip[] {
  const chips: Ship2PresetChip[] = [];
  const targetId = enemies[0]?.id;
  const targetName = enemies[0]?.name;
  const fireable = firableMounts(profile);
  const allKeys = fireable.map((m) => m.key);
  // "Best" = highest EXPECTED damage (dice × dmgPerHit × hit chance), not raw
  // max-possible — a reliable railgun (1d6≥4, 50%) can beat a swingier beam
  // lance (2d6≥5, ~33%) despite the lance's higher max damage.
  const expectedDamage = (m: (typeof fireable)[number]) => (m.dice * m.dmgPerHit * Math.max(0, 7 - m.hitOn)) / 6;
  const bestMount = [...fireable].sort((a, b) => expectedDamage(b) - expectedDamage(a))[0];

  if (allKeys.length) {
    chips.push({
      label: `Alpha strike — all guns${targetName ? ` on ${targetName}` : ""}`,
      combatAction: { type: "allocate", alloc: { mounts: allKeys, shields: 0, engines: 0, targetId } },
    });
  }
  if (allKeys.length && profile.shieldCap > 0) {
    chips.push({
      label: "Guns + shields",
      combatAction: { type: "allocate", alloc: { mounts: allKeys, shields: profile.shieldCap, engines: 0, targetId } },
    });
  }
  if (bestMount && profile.engineCap > 0) {
    chips.push({
      label: `Evasive attack — ${bestMount.name} + engines`,
      combatAction: { type: "allocate", alloc: { mounts: [bestMount.key], shields: 0, engines: profile.engineCap, targetId } },
    });
  }
  if (profile.shieldCap > 0 || profile.engineCap > 0) {
    chips.push({
      label: "Run silent — shields + engines, hold fire",
      combatAction: { type: "allocate", alloc: { mounts: [], shields: profile.shieldCap, engines: profile.engineCap } },
    });
  }
  for (const u of consumables) {
    chips.push({
      label: `${u.verb} ${u.name} (×${u.count})`,
      combatAction: { type: "allocate", alloc: { mounts: [], shields: 0, engines: 0, itemId: u.itemId } },
    });
  }
  chips.push({ label: burstReady ? "Burst-drive away" : "Break off and run", combatAction: { type: "flee" } });
  return chips;
}

// ── Customization (HANDOFF_COMBAT_V2_3.md Task B) — slot accounting, stock
// materialization, and the shipyard's shared truth (tier/slot/already-fitted).
// No Ship schema change anywhere below: every helper reads/writes columns
// the row already has (weapons[] jsonb + the system booleans/ints).

type MountItemEntry = { name: string; type: string; damage: string; ammo?: number; price: number; tier: string };
type SystemItemEntry = { name: string; field: string; numericValue?: number; price: number; tier: string };
type OutfittingCatalog = { mountItems: Record<string, MountItemEntry>; systemItems: Record<string, SystemItemEntry> };

/** The reverse of WEAPON_TYPE_TO_MOUNT — a mount's catalog id back to the
 *  `ShipWeapon.type` that derives it, for materializing a virtual
 *  class-default mount into a real `weapons[]` entry. */
const MOUNT_TO_WEAPON_TYPE: Record<string, string> = {
  railgun: "kinetic",
  beamLance: "energy",
  autocannon: "ion",
  missileRack: "missile",
};

/** `{ used, cap }` for this ship's mount slots — used = the real weapons[]
 *  count, or the class's default mount count when weapons[] is still empty
 *  (a fresh ship hasn't materialized its stock loadout yet, but it's still
 *  "using" those slots). */
export function shipMountSlots(ship: Ship): { used: number; cap: number } {
  const classes = ship2Catalog.classes as Record<string, ClassCatalogEntry & { mountSlots: number }>;
  const cls = classes[ship.shipClass];
  const used = ship.weapons.length > 0 ? ship.weapons.length : (cls?.mounts.length ?? 0);
  return { used, cap: cls?.mountSlots ?? 1 };
}

/** Which of the five system fields is currently fitted. Exported — the
 *  buy/sell runtime (llm/runtimeEconomy.ts) needs the SAME check the
 *  shipyard's own truth table uses, not a re-derived copy. */
export function isSystemFitted(ship: Ship, field: string): boolean {
  switch (field) {
    case "damageReduction":
      return ship.damageReduction > 0;
    case "evasiveAcBonus":
      return ship.evasiveAcBonus > 0;
    case "hasShield":
      return ship.hasShield;
    case "hasPointDefense":
      return ship.hasPointDefense;
    case "burstDriveReady":
      return ship.burstDriveReady;
    default:
      return false;
  }
}

/** Install a system item — sets the field the purchase pays for. */
export function applyShipSystemField(ship: Ship, field: string, numericValue: number | undefined): Ship {
  switch (field) {
    case "damageReduction":
      return { ...ship, damageReduction: numericValue ?? 1 };
    case "evasiveAcBonus":
      return { ...ship, evasiveAcBonus: numericValue ?? 1 };
    case "hasShield":
      return { ...ship, hasShield: true, shieldReady: true };
    case "hasPointDefense":
      return { ...ship, hasPointDefense: true };
    case "burstDriveReady":
      return { ...ship, burstDriveReady: true };
    default:
      return ship;
  }
}

/** Strip a fitted system — the sell side of `applyShipSystemField`. */
export function unapplyShipSystemField(ship: Ship, field: string): Ship {
  switch (field) {
    case "damageReduction":
      return { ...ship, damageReduction: 0 };
    case "evasiveAcBonus":
      return { ...ship, evasiveAcBonus: 0 };
    case "hasShield":
      return { ...ship, hasShield: false };
    case "hasPointDefense":
      return { ...ship, hasPointDefense: false };
    case "burstDriveReady":
      return { ...ship, burstDriveReady: false };
    default:
      return ship;
  }
}

/** A weapon's resale value by TYPE — the same price the shipyard would
 *  charge to buy that type new. An unrecognized type (a hand-authored weapon
 *  with no catalog match) falls back to the kinetic cannon's price, per
 *  HANDOFF_COMBAT_V2_3.md's rule. */
export function mountItemPriceForType(type: string): number {
  const outfitting = ship2Catalog.outfitting as OutfittingCatalog;
  const match = Object.values(outfitting.mountItems).find((item) => item.type === type);
  return match?.price ?? outfitting.mountItems.kineticCannon?.price ?? 250;
}

/** `{ used, cap }` for this ship's system slots. A SPENT burst drive
 *  (`burstDriveReady: false`) does NOT count as fitted — using the one-shot
 *  frees the slot; re-buying re-arms it (HANDOFF_COMBAT_V2_3.md's rule). */
export function shipSystemSlots(ship: Ship): { used: number; cap: number } {
  const classes = ship2Catalog.classes as Record<string, ClassCatalogEntry & { systemSlots: number }>;
  const cls = classes[ship.shipClass];
  const fields = ["damageReduction", "evasiveAcBonus", "hasShield", "hasPointDefense", "burstDriveReady"];
  const used = fields.filter((f) => isSystemFitted(ship, f)).length;
  return { used, cap: cls?.systemSlots ?? 1 };
}

/**
 * A ship with an EMPTY `weapons[]` derives its class-default mounts today
 * (deriveShip2Profile's fallback branch) — but nothing has actually been
 * WRITTEN. The first shipyard install on such a ship must materialize those
 * defaults into real `weapons[]` entries first, so buying a new mount can
 * never silently delete the stock guns the player has been firing. Idempotent
 * (a ship with any weapons already is returned unchanged) and pure.
 */
export function materializeStockWeapons(ship: Ship): Ship {
  if (ship.weapons.length > 0) return ship;
  const classes = ship2Catalog.classes as Record<string, ClassCatalogEntry>;
  const cls = classes[ship.shipClass];
  if (!cls) return ship;
  const outfitting = ship2Catalog.outfitting as OutfittingCatalog;
  const itemByType = new Map(Object.values(outfitting.mountItems).map((item) => [item.type, item]));
  const weapons = cls.mounts.map((mountId) => {
    const type = MOUNT_TO_WEAPON_TYPE[mountId] ?? "kinetic";
    const item = itemByType.get(type);
    return {
      name: item?.name ?? mountId,
      type: type as "kinetic" | "energy" | "ion" | "missile",
      damage: item?.damage ?? "2d6",
      ammo: mountId === "missileRack" ? (item?.ammo ?? 4) : undefined,
    };
  });
  return { ...ship, weapons };
}

export interface ShipyardEntry {
  id: string;
  name: string;
  price: number;
  canBuy: boolean;
  reason?: string;
}

export interface ShipyardStock {
  mounts: ShipyardEntry[];
  systems: ShipyardEntry[];
}

const MARKET_TIER_ORDER: Record<string, number> = { T1: 1, T2: 2, T3: 3 };

/**
 * The shipyard's full truth table — tier/slot/already-fitted logic lives
 * HERE so the chip layer (shared/combat.ts, PlayClient) and the buy/sell
 * runtime (llm/runtimeEconomy.ts) never disagree about what's purchasable.
 * Affordability (credits) is NOT applied here — that's the chip layer's job,
 * same division `marketChips` already uses for consumables/gear. Empty when
 * there's no ship or no market at the current location.
 */
export function shipyardStock(state: CampaignState): ShipyardStock {
  const ship = state.ship;
  const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const tier = marketTierFor(loc);
  if (!ship || !tier) return { mounts: [], systems: [] };

  const rep = localRep(loc, state.factions, state.factionRep);
  const priceFor = (base: number) => Math.round(base * repPriceFactor(rep));
  const outfitting = ship2Catalog.outfitting as OutfittingCatalog;

  const { used: mountsUsed, cap: mountCap } = shipMountSlots(ship);
  const mounts: ShipyardEntry[] = Object.entries(outfitting.mountItems).map(([id, item]) => {
    let reason: string | undefined;
    if (MARKET_TIER_ORDER[item.tier] > MARKET_TIER_ORDER[tier]) reason = "above what this market carries";
    else if (mountsUsed >= mountCap) reason = "no free mount slot";
    return { id, name: item.name, price: priceFor(item.price), canBuy: !reason, reason };
  });

  const { used: systemsUsed, cap: systemCap } = shipSystemSlots(ship);
  const systems: ShipyardEntry[] = Object.entries(outfitting.systemItems).map(([id, item]) => {
    let reason: string | undefined;
    if (MARKET_TIER_ORDER[item.tier] > MARKET_TIER_ORDER[tier]) reason = "above what this market carries";
    else if (isSystemFitted(ship, item.field)) reason = "already fitted";
    else if (systemsUsed >= systemCap) reason = "no free system slot";
    return { id, name: item.name, price: priceFor(item.price), canBuy: !reason, reason };
  });

  return { mounts, systems };
}

export interface ShipyardChip {
  label: string;
  buyShipItem?: string;
  sellShipItem?: string;
}

/**
 * Engine-generated shipyard chips (HANDOFF_COMBAT_V2_3.md Task C) — shown
 * alongside `marketChips` from the same shopping-intent block: affordable
 * installs (`shipyardStock`'s tier/slot/already-fitted truth, further
 * filtered by credits here — same division `marketChips` uses) plus a strip
 * chip for each fitted mount/system. Capped at 6 total, like the market.
 */
export function shipyardChips(state: CampaignState): ShipyardChip[] {
  const stock = shipyardStock(state);
  const credits = state.characters.find((c) => c.kind === "pc")?.credits ?? 0;
  const buyChips: ShipyardChip[] = [...stock.mounts, ...stock.systems]
    .filter((e) => e.canBuy && e.price <= credits)
    .map((e) => ({ label: `Install ${e.name} — ${fmtCredits(e.price)}`, buyShipItem: e.id }));

  const stripChips: ShipyardChip[] = [];
  const ship = state.ship;
  if (ship) {
    const profile = deriveShip2Profile(ship, []);
    for (const m of profile.mounts) {
      if (m.weaponIndex === undefined) continue; // a virtual stock mount — nothing real to strip yet
      const weaponType = MOUNT_TO_WEAPON_TYPE[m.id] ?? "kinetic";
      const refund = Math.max(1, Math.round(mountItemPriceForType(weaponType) * SELL_RATE));
      stripChips.push({ label: `Strip ${m.name} — +${fmtCredits(refund)}`, sellShipItem: m.key });
    }
    const outfitting = ship2Catalog.outfitting as OutfittingCatalog;
    for (const [id, item] of Object.entries(outfitting.systemItems)) {
      if (!isSystemFitted(ship, item.field)) continue;
      const refund = Math.max(1, Math.round(item.price * SELL_RATE));
      stripChips.push({ label: `Strip ${item.name} — +${fmtCredits(refund)}`, sellShipItem: id });
    }
  }

  return [...buyChips, ...stripChips].slice(0, 6);
}
