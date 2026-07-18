import type { PackShip2 } from "../types";

/**
 * Ship2 CombatSystem statlines (COMBAT_V2.md Part B, HANDOFF_COMBAT_V2_2.md):
 * power-allocation + dice-profile ship combat. `mounts` are weapon dice
 * profiles (dice/hitOn/dmgPerHit/power cost) — a natural 6 always hits
 * regardless of any evasion-raised threshold. `overchargeHitOn` is the
 * lowered hit-on when +1 power is diverted to that mount (beam lance only
 * this slice). `ammoLimited` mounts (missile racks) are subject to the
 * defender's point-defense roll-down (`pdHitOn`) before armor/shields.
 *
 * `classes` is the per-shipClass statline (reactor output, engine/shield
 * caps, armor, owned mount ids in priority order) shared by the player's
 * derived profile AND enemy spawns; `policy` is the enemy's deterministic
 * allocation weights, resolved token-by-token in order ("guns" = fund the
 * next unfunded owned mount; "shields"/"engines" = +1 to that pool) until
 * the reactor is spent or every token is exhausted.
 *
 * A TYPED `.ts` module (not raw JSON, unlike weapons/shipClasses/etc.) so
 * `policy` narrows to the real literal union instead of `string[]` — this
 * data needs REAL referential validation (pack.test.ts / validatePack), the
 * same reason creation/briefs/openings/npcFlavor are `.ts` too.
 */
export const driftShip2: PackShip2 = {
  mounts: {
    railgun: { name: "Railgun", dice: 1, hitOn: 4, dmgPerHit: 3, power: 2 },
    autocannon: { name: "Autocannon battery", dice: 6, hitOn: 6, dmgPerHit: 1, power: 2 },
    beamLance: { name: "Beam lance", dice: 2, hitOn: 5, dmgPerHit: 2, power: 2, overchargeHitOn: 4 },
    missileRack: { name: "Missile rack", dice: 4, hitOn: 4, dmgPerHit: 1, power: 2, ammoLimited: true, pdHitOn: 5 },
  },
  classes: {
    scout: { reactor: 3, engineCap: 3, shieldCap: 0, armor: 0, mounts: ["autocannon"], policy: ["engines", "guns"] },
    fighter: { reactor: 4, engineCap: 2, shieldCap: 0, armor: 0, mounts: ["railgun", "autocannon"], policy: ["guns", "guns", "engines"] },
    hauler: { reactor: 3, engineCap: 1, shieldCap: 1, armor: 1, mounts: ["railgun"], policy: ["guns", "shields"] },
    gunship: { reactor: 5, engineCap: 1, shieldCap: 2, armor: 0, mounts: ["railgun", "beamLance"], policy: ["guns", "guns", "shields"] },
    corvette: {
      reactor: 6, engineCap: 1, shieldCap: 2, armor: 1,
      mounts: ["railgun", "autocannon", "missileRack"], policy: ["guns", "guns", "guns", "shields"],
    },
  },
};
