import type { Character, Ship } from "./schemas";
import type { UsableConsumable } from "./items";
import type { CombatAction } from "./combat";
import { ship2 as ship2Catalog } from "@/content";

/**
 * Client-safe ship2 types + pure helpers (COMBAT_V2.md Part B, HANDOFF_COMBAT_V2_2.md
 * Task A) — profile derivation, allocation clamping, and preset chips. No `llm/`
 * import here: `PlayClient.tsx` rebuilds combat chips on reload (the seam's trap 4),
 * so everything the client needs to render/validate an allocation lives in shared/.
 */

export interface Ship2MountInstance {
  /** Catalog mount id (railgun/autocannon/beamLance/missileRack). */
  id: string;
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
  /** Mount ids fired this round (each costs its `power`, drawn from `reactor`). */
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
type ClassCatalogEntry = { reactor: number; engineCap: number; shieldCap: number; armor: number; mounts: string[] };

function mountFromCatalog(mountId: string, nameOverride: string | undefined, ammo: number | undefined): Ship2MountInstance {
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
  };
}

/**
 * Derive the player's ship2 profile from the EXISTING `Ship` row + the class
 * table — no schema change, no migration. Frozen into `combat.ship2.player`
 * at fight start (llm/combat/ship2System.ts), so mid-fight upgrades never
 * shift the numbers under a live round.
 */
export function deriveShip2Profile(ship: Ship, standingCrew: Character[]): Ship2Profile {
  const classes = ship2Catalog.classes as Record<string, ClassCatalogEntry>;
  const cls = classes[ship.shipClass];
  const mounts: Ship2MountInstance[] = ship.weapons.length
    ? ship.weapons.map((w) => mountFromCatalog(WEAPON_TYPE_TO_MOUNT[w.type] ?? "railgun", w.name, w.ammo))
    : (cls?.mounts ?? []).map((id) => mountFromCatalog(id, undefined, undefined));

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
 * Clamp a (possibly client-crafted) allocation to what this profile can
 * actually afford — NEVER throws; drops what doesn't fit, in mounts→
 * shields→engines order (trap 6: the engine never trusts the client's raw
 * numbers). A dry ammo-limited mount can't be fired. Overcharge is granted to
 * the first requested, still-affordable mount that supports it; if the extra
 * +1 power doesn't fit, the mount still fires at its base profile rather than
 * being dropped outright.
 */
export function validateAllocation(profile: Ship2Profile, alloc: Allocation): Allocation {
  const byId = new Map(profile.mounts.map((m) => [m.id, m]));
  let remaining = Math.max(0, profile.reactor);
  const mounts: string[] = [];
  let overcharged = false;

  for (const id of alloc.mounts ?? []) {
    if (mounts.includes(id)) continue;
    const m = byId.get(id);
    if (!m) continue;
    if (m.ammoLimited && (m.ammo ?? 0) <= 0) continue;
    const wantsOvercharge = !!alloc.overcharge && !overcharged && m.overchargeHitOn !== undefined;
    const cost = m.power + (wantsOvercharge ? 1 : 0);
    if (cost <= remaining) {
      remaining -= cost;
      mounts.push(id);
      if (wantsOvercharge) overcharged = true;
    } else if (wantsOvercharge && m.power <= remaining) {
      // Can't afford the overcharge premium — still fire it at base profile.
      remaining -= m.power;
      mounts.push(id);
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
  const allIds = fireable.map((m) => m.id);
  // "Best" = highest EXPECTED damage (dice × dmgPerHit × hit chance), not raw
  // max-possible — a reliable railgun (1d6≥4, 50%) can beat a swingier beam
  // lance (2d6≥5, ~33%) despite the lance's higher max damage.
  const expectedDamage = (m: (typeof fireable)[number]) => (m.dice * m.dmgPerHit * Math.max(0, 7 - m.hitOn)) / 6;
  const bestMount = [...fireable].sort((a, b) => expectedDamage(b) - expectedDamage(a))[0];

  if (allIds.length) {
    chips.push({
      label: `Alpha strike — all guns${targetName ? ` on ${targetName}` : ""}`,
      combatAction: { type: "allocate", alloc: { mounts: allIds, shields: 0, engines: 0, targetId } },
    });
  }
  if (allIds.length && profile.shieldCap > 0) {
    chips.push({
      label: "Guns + shields",
      combatAction: { type: "allocate", alloc: { mounts: allIds, shields: profile.shieldCap, engines: 0, targetId } },
    });
  }
  if (bestMount && profile.engineCap > 0) {
    chips.push({
      label: `Evasive attack — ${bestMount.name} + engines`,
      combatAction: { type: "allocate", alloc: { mounts: [bestMount.id], shields: 0, engines: profile.engineCap, targetId } },
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
