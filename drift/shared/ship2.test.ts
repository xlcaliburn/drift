import { describe, it, expect } from "vitest";
import {
  deriveShip2Profile,
  deriveEnemyShip2Profile,
  ship2ClassPolicy,
  validateAllocation,
  ship2Presets,
  shipMountSlots,
  shipSystemSlots,
  materializeStockWeapons,
  shipyardStock,
  type Ship2Profile,
} from "./ship2";
import type { Character, Ship, CampaignState } from "./schemas";

function ship(over: Partial<Ship> = {}): Ship {
  return {
    id: "s", campaignId: "c", name: "Wren", shipClass: "hauler", hp: 20, maxHp: 20, ac: 12,
    evasiveAcBonus: 0, damageReduction: 0, weapons: [], hasShield: false, shieldReady: true,
    hasPointDefense: false, burstDriveReady: false, dcModifier: 0, buyoutRemaining: 0,
    ...over,
  } as Ship;
}

function crewMember(role: string): Character {
  return { id: `npc-${role}`, kind: "party", name: role, crewRole: role, hp: 10, maxHp: 10 } as unknown as Character;
}

describe("deriveShip2Profile", () => {
  it("derives the base statline from the shipClass table (hauler, no upgrades)", () => {
    const p = deriveShip2Profile(ship(), []);
    expect(p.shipClass).toBe("hauler");
    expect(p.reactor).toBe(3);
    expect(p.engineCap).toBe(1);
    expect(p.shieldCap).toBe(0); // hasShield false → 0 regardless of the class's own shieldCap
    expect(p.armor).toBe(1); // hauler's baseline class armor
    expect(p.hasPointDefense).toBe(false);
    expect(p.gunnerBoost).toBe(false);
    expect(p.mounts.map((m) => m.id)).toEqual(["railgun"]); // no weapons[] → class defaults
  });

  it("hasShield unlocks at least 1 shield point even if the class table has 0", () => {
    const p = deriveShip2Profile(ship({ shipClass: "scout", hasShield: true }), []);
    expect(p.shieldCap).toBeGreaterThanOrEqual(1); // scout's class shieldCap is 0
  });

  it("evasiveAcBonus and a pilot both add +1 engineCap (additively)", () => {
    const base = deriveShip2Profile(ship(), []).engineCap;
    const withEvasive = deriveShip2Profile(ship({ evasiveAcBonus: 2 }), []).engineCap;
    const withPilot = deriveShip2Profile(ship(), [crewMember("pilot")]).engineCap;
    const withBoth = deriveShip2Profile(ship({ evasiveAcBonus: 2 }), [crewMember("pilot")]).engineCap;
    expect(withEvasive).toBe(base + 1);
    expect(withPilot).toBe(base + 1);
    expect(withBoth).toBe(base + 2);
  });

  it("an aboard engineer adds +1 reactor", () => {
    const base = deriveShip2Profile(ship(), []).reactor;
    const withEngineer = deriveShip2Profile(ship(), [crewMember("engineer")]).reactor;
    expect(withEngineer).toBe(base + 1);
  });

  it("an aboard gunner sets gunnerBoost", () => {
    expect(deriveShip2Profile(ship(), [crewMember("gunner")]).gunnerBoost).toBe(true);
    expect(deriveShip2Profile(ship(), []).gunnerBoost).toBe(false);
  });

  it("damageReduction floors armor at 1 even for a 0-armor class", () => {
    const p = deriveShip2Profile(ship({ shipClass: "scout", damageReduction: 1 }), []);
    expect(p.armor).toBe(1); // scout's class armor is 0
  });

  it("maps ship.weapons[] by type to mount ids, keeping the weapon's own name + ammo", () => {
    const p = deriveShip2Profile(
      ship({ weapons: [{ name: "Old Betsy", type: "missile", damage: "1d8", ammo: 3 }] }),
      [],
    );
    expect(p.mounts).toHaveLength(1);
    expect(p.mounts[0].id).toBe("missileRack");
    expect(p.mounts[0].name).toBe("Old Betsy");
    expect(p.mounts[0].ammo).toBe(3);
    expect(p.mounts[0].dmgPerHit).toBe(1); // from the catalog, not the weapon's own damage string
  });

  it("a single mount keys equal to its id — single-mount ships are unaffected by the key scheme", () => {
    const p = deriveShip2Profile(ship({ weapons: [{ name: "Rifle", type: "kinetic", damage: "2d6" }] }), []);
    expect(p.mounts[0].key).toBe("railgun");
    expect(p.mounts[0].weaponIndex).toBe(0);
  });

  it("two of the same weapon type derive TWO distinct, independently keyed instances (HANDOFF_COMBAT_V2_3 Task A)", () => {
    const p = deriveShip2Profile(
      ship({
        weapons: [
          { name: "Port cannon", type: "kinetic", damage: "2d6" },
          { name: "Starboard cannon", type: "kinetic", damage: "2d6" },
        ],
      }),
      [],
    );
    expect(p.mounts).toHaveLength(2);
    expect(p.mounts.map((m) => m.id)).toEqual(["railgun", "railgun"]);
    expect(p.mounts.map((m) => m.key)).toEqual(["railgun", "railgun-2"]);
    expect(p.mounts.map((m) => m.name)).toEqual(["Port cannon", "Starboard cannon"]);
    expect(p.mounts.map((m) => m.weaponIndex)).toEqual([0, 1]);
  });

  it("a class-default virtual mount (empty weapons[]) has no weaponIndex", () => {
    const p = deriveShip2Profile(ship(), []); // hauler, no weapons[]
    expect(p.mounts[0].weaponIndex).toBeUndefined();
  });

  it("hasPointDefense passes through from the ship row directly", () => {
    expect(deriveShip2Profile(ship({ hasPointDefense: true }), []).hasPointDefense).toBe(true);
  });
});

describe("deriveEnemyShip2Profile", () => {
  it("derives from the shipClass table with no crew passives", () => {
    const p = deriveEnemyShip2Profile("corvette", true, 4);
    expect(p.reactor).toBe(6);
    expect(p.shieldCap).toBe(2);
    expect(p.armor).toBe(1);
    expect(p.gunnerBoost).toBe(false);
    expect(p.hasPointDefense).toBe(true);
    expect(p.mounts.map((m) => m.id)).toEqual(["railgun", "autocannon", "missileRack"]);
    expect(p.mounts.find((m) => m.id === "missileRack")!.ammo).toBe(4);
  });

  it("an unknown shipClass falls back to safe defaults rather than throwing", () => {
    expect(() => deriveEnemyShip2Profile("not-a-real-class", false, undefined)).not.toThrow();
  });
});

describe("ship2ClassPolicy", () => {
  it("returns the class's authored policy", () => {
    expect(ship2ClassPolicy("scout")).toEqual(["engines", "guns"]);
    expect(ship2ClassPolicy("corvette")).toEqual(["guns", "guns", "guns", "shields"]);
  });

  it("falls back to a single guns token for an unknown class", () => {
    expect(ship2ClassPolicy("not-a-real-class")).toEqual(["guns"]);
  });
});

const profile = (over: Partial<Ship2Profile> = {}): Ship2Profile => ({
  shipClass: "gunship",
  reactor: 5,
  engineCap: 1,
  shieldCap: 2,
  armor: 0,
  hasPointDefense: false,
  gunnerBoost: false,
  mounts: [
    { id: "railgun", key: "railgun", name: "Railgun", power: 2, dice: 1, hitOn: 4, dmgPerHit: 3 },
    { id: "beamLance", key: "beamLance", name: "Beam lance", power: 2, dice: 2, hitOn: 5, dmgPerHit: 2, overchargeHitOn: 4 },
    { id: "missileRack", key: "missileRack", name: "Missile rack", power: 2, dice: 4, hitOn: 4, dmgPerHit: 1, ammoLimited: true, pdHitOn: 5, ammo: 0 },
  ],
  ...over,
});

describe("validateAllocation", () => {
  it("passes through a well-formed, affordable allocation unchanged", () => {
    const p = profile();
    const out = validateAllocation(p, { mounts: ["railgun"], shields: 1, engines: 1 });
    expect(out.mounts).toEqual(["railgun"]);
    expect(out.shields).toBe(1);
    expect(out.engines).toBe(1);
  });

  it("drops mounts once the reactor is spent (mounts funded first, in request order)", () => {
    const p = profile({ reactor: 2 }); // only enough for ONE 2-power mount
    const out = validateAllocation(p, { mounts: ["railgun", "beamLance"], shields: 0, engines: 0 });
    expect(out.mounts).toEqual(["railgun"]);
  });

  it("drops an unowned mount id entirely", () => {
    const out = validateAllocation(profile(), { mounts: ["autocannon"], shields: 0, engines: 0 });
    expect(out.mounts).toEqual([]);
  });

  it("can't fire a dry ammo-limited mount", () => {
    const out = validateAllocation(profile(), { mounts: ["missileRack"], shields: 0, engines: 0 }); // ammo: 0
    expect(out.mounts).toEqual([]);
  });

  it("clamps shields/engines to their caps regardless of what's requested", () => {
    const out = validateAllocation(profile({ reactor: 99 }), { mounts: [], shields: 50, engines: 50 });
    expect(out.shields).toBe(2); // shieldCap
    expect(out.engines).toBe(1); // engineCap
  });

  it("shields/engines only draw from what's LEFT after mounts (spend order: mounts → shields → engines)", () => {
    const p = profile({ reactor: 3 }); // railgun (2) leaves 1 for shields/engines
    const out = validateAllocation(p, { mounts: ["railgun"], shields: 2, engines: 2 });
    expect(out.mounts).toEqual(["railgun"]);
    expect(out.shields + out.engines).toBeLessThanOrEqual(1);
  });

  it("overcharge is granted to the first requested mount that supports it", () => {
    const out = validateAllocation(profile({ reactor: 5 }), { mounts: ["railgun", "beamLance"], shields: 0, engines: 0, overcharge: true });
    expect(out.overcharge).toBe(true);
    expect(out.mounts).toEqual(["railgun", "beamLance"]); // both fit (2+2=4 ≤ 5) — overcharge just costs +1 more
  });

  it("overcharge is false when nothing fired supports it", () => {
    const out = validateAllocation(profile(), { mounts: ["railgun"], shields: 0, engines: 0, overcharge: true });
    expect(out.overcharge).toBe(false);
  });

  it("a mount still fires at base profile when only the +1 overcharge premium doesn't fit", () => {
    const p = profile({ reactor: 2 }); // exactly enough for beamLance's base 2, not 3
    const out = validateAllocation(p, { mounts: ["beamLance"], shields: 0, engines: 0, overcharge: true });
    expect(out.mounts).toEqual(["beamLance"]);
    expect(out.overcharge).toBe(false);
  });

  it("never throws on a hostile payload (negative/huge numbers, duplicate mounts, garbage ids)", () => {
    expect(() =>
      validateAllocation(profile(), {
        mounts: ["railgun", "railgun", "not-a-real-mount", "railgun"],
        shields: -5,
        engines: 999999,
      }),
    ).not.toThrow();
    const out = validateAllocation(profile(), { mounts: ["railgun", "railgun"], shields: -5, engines: 999999 });
    expect(out.mounts).toEqual(["railgun"]); // no double-firing the same mount
    expect(out.shields).toBe(0);
  });

  it("passes through targetId and itemId untouched", () => {
    const out = validateAllocation(profile(), { mounts: [], shields: 0, engines: 0, targetId: "e-2", itemId: "shieldCell" });
    expect(out.targetId).toBe("e-2");
    expect(out.itemId).toBe("shieldCell");
  });
});

describe("ship2Presets", () => {
  const enemies = [{ id: "e-1", name: "Raider" }];

  it("includes an alpha-strike chip firing every owned, loaded mount", () => {
    const chips = ship2Presets(profile(), enemies, []);
    const alpha = chips.find((c) => c.label.startsWith("Alpha strike"));
    expect(alpha).toBeTruthy();
    const alloc = alpha!.combatAction.alloc!;
    expect(alloc.mounts).toEqual(["railgun", "beamLance"]); // missileRack excluded — 0 ammo
    expect(alloc.targetId).toBe("e-1");
  });

  it("includes guns+shields only when the ship actually has shields", () => {
    expect(ship2Presets(profile(), enemies, []).some((c) => c.label === "Guns + shields")).toBe(true);
    expect(ship2Presets(profile({ shieldCap: 0 }), enemies, []).some((c) => c.label === "Guns + shields")).toBe(false);
  });

  it("evasive attack fires only the single highest-EXPECTED-damage mount", () => {
    // railgun: 1d6≥4 (50%) × 3 dmg = 1.5 expected. beamLance: 2d6≥5 (~33%) × 2
    // dmg = 1.33 expected — railgun wins despite the lance's higher max roll.
    const chips = ship2Presets(profile(), enemies, []);
    const evasive = chips.find((c) => c.label.startsWith("Evasive attack"));
    expect(evasive!.combatAction.alloc!.mounts).toEqual(["railgun"]);
    expect(evasive!.combatAction.alloc!.engines).toBe(profile().engineCap);
  });

  it("run silent holds fire and pours everything into shields/engines", () => {
    const chips = ship2Presets(profile(), enemies, []);
    const silent = chips.find((c) => c.label.startsWith("Run silent"))!;
    expect(silent.combatAction.alloc!.mounts).toEqual([]);
  });

  it("one chip per held consumable, plus a flee chip (labeled by burst-drive readiness)", () => {
    const chips = ship2Presets(profile(), enemies, [{ itemId: "shieldCell", name: "Shield cell", count: 2, verb: "Divert" }]);
    expect(chips.some((c) => c.label === "Divert Shield cell (×2)")).toBe(true);
    expect(chips.at(-1)!.label).toBe("Break off and run");
    const readyChips = ship2Presets(profile(), enemies, [], true);
    expect(readyChips.at(-1)!.label).toBe("Burst-drive away");
    expect(readyChips.at(-1)!.combatAction).toEqual({ type: "flee" });
  });

  it("no owned mounts still returns a usable (defense-only) chip set", () => {
    const chips = ship2Presets(profile({ mounts: [] }), enemies, []);
    expect(chips.some((c) => c.label.startsWith("Alpha strike"))).toBe(false);
    expect(chips.some((c) => c.label.startsWith("Run silent"))).toBe(true);
    expect(chips.at(-1)!.label).toMatch(/run|away/i);
  });
});

describe("shipMountSlots (HANDOFF_COMBAT_V2_3.md Task B)", () => {
  it("used = the class default count when weapons[] is still empty", () => {
    expect(shipMountSlots(ship())).toEqual({ used: 1, cap: 2 }); // hauler: 1 default mount, mountSlots 2
  });

  it("used = the real weapons[] count once materialized", () => {
    const s = ship({
      weapons: [
        { name: "A", type: "kinetic", damage: "2d6" },
        { name: "B", type: "ion", damage: "1d6" },
      ],
    });
    expect(shipMountSlots(s)).toEqual({ used: 2, cap: 2 });
  });

  it("cap scales with shipClass", () => {
    expect(shipMountSlots(ship({ shipClass: "scout" })).cap).toBe(1);
    expect(shipMountSlots(ship({ shipClass: "corvette" })).cap).toBe(4);
  });
});

describe("shipSystemSlots (HANDOFF_COMBAT_V2_3.md Task B)", () => {
  it("counts each fitted field once", () => {
    const s = ship({ damageReduction: 1, hasShield: true });
    expect(shipSystemSlots(s)).toEqual({ used: 2, cap: 3 }); // hauler systemSlots 3
  });

  it("a SPENT burst drive (ready: false) does NOT count as fitted — the one-shot frees its slot", () => {
    const armed = ship({ burstDriveReady: true });
    const spent = ship({ burstDriveReady: false });
    expect(shipSystemSlots(armed).used).toBe(1);
    expect(shipSystemSlots(spent).used).toBe(0);
  });

  it("a bare ship (no systems fitted) uses 0", () => {
    expect(shipSystemSlots(ship()).used).toBe(0);
  });
});

describe("materializeStockWeapons (HANDOFF_COMBAT_V2_3.md Task B)", () => {
  it("is a no-op (idempotent) when weapons[] already has entries", () => {
    const s = ship({ weapons: [{ name: "Old Betsy", type: "kinetic", damage: "1d8" }] });
    expect(materializeStockWeapons(s)).toBe(s); // same reference — true no-op
  });

  it("writes the class's default mounts as real weapons[] entries", () => {
    const s = ship({ shipClass: "corvette" }); // default mounts: railgun, autocannon, missileRack
    const out = materializeStockWeapons(s);
    expect(out.weapons).toHaveLength(3);
    expect(out.weapons.map((w) => w.type)).toEqual(["kinetic", "ion", "missile"]);
    expect(out.weapons[2].ammo).toBeGreaterThan(0); // the missile rack gets starting ammo
  });

  it("materializing then deriving the ship2 profile is unchanged from the virtual default", () => {
    const s = ship({ shipClass: "hauler" });
    const before = deriveShip2Profile(s, []);
    const after = deriveShip2Profile(materializeStockWeapons(s), []);
    expect(after.mounts.map((m) => m.id)).toEqual(before.mounts.map((m) => m.id));
  });
});

describe("shipyardStock (HANDOFF_COMBAT_V2_3.md Task B)", () => {
  function state(over: { ship?: Ship; tags?: string[]; rep?: number } = {}): CampaignState {
    return {
      campaign: { id: "c", universeId: "u", currentLocationId: "loc-dock", tendaysElapsed: 0 },
      universe: { id: "u", name: "U" },
      characters: [],
      ship: over.ship ?? ship(),
      factions: [{ id: "f-dock", name: "Dockers", defaultRep: 0, alignment: "neutral", homeLocationId: "loc-dock", color: "#fff" }],
      factionRep: [{ factionId: "f-dock", rep: over.rep ?? 0, standing: "neutral" }],
      // Always keep the "dock" tag alongside any market-tier tag so localRep
      // still matches the f-dock faction (tag/id substring match) — a
      // caller-supplied tags list otherwise loses the rep hookup entirely.
      locations: [{ id: "loc-dock", universeId: "u", name: "Dock", tags: [...(over.tags ?? []), "dock"] }],
      clocks: [],
      threads: [],
      contracts: [],
      npcs: [],
    } as unknown as CampaignState;
  }

  it("empty when there's no ship", () => {
    expect(shipyardStock({ ...state(), ship: undefined } as unknown as CampaignState)).toEqual({ mounts: [], systems: [] });
  });

  it("empty when the current location has no market (hazard/hidden)", () => {
    expect(shipyardStock(state({ tags: ["hazard"] }))).toEqual({ mounts: [], systems: [] });
  });

  it("T3 items are unbuyable at a T1 (backwater) market", () => {
    const stock = shipyardStock(state({ tags: [] })); // no commerce/blackmarket tag → T1
    const missileRack = stock.mounts.find((m) => m.id === "missileRack")!; // T3 item
    expect(missileRack.canBuy).toBe(false);
    expect(missileRack.reason).toMatch(/above/);
    const kineticCannon = stock.mounts.find((m) => m.id === "kineticCannon")!; // T1 item
    expect(kineticCannon.canBuy).toBe(true);
  });

  it("a full mount slot blocks a buy with a clear reason", () => {
    const full = ship({
      shipClass: "scout", // mountSlots 1
      weapons: [{ name: "Gun", type: "ion", damage: "1d6" }],
    });
    const stock = shipyardStock(state({ ship: full, tags: ["blackmarket"] })); // T3 market, tier is not the blocker
    expect(stock.mounts.every((m) => !m.canBuy && m.reason === "no free mount slot")).toBe(true);
  });

  it("an already-fitted system can't be bought again", () => {
    const s = ship({ hasShield: true });
    const stock = shipyardStock(state({ ship: s, tags: ["blackmarket"] }));
    const shieldEmitter = stock.systems.find((sys) => sys.id === "shieldEmitter")!;
    expect(shieldEmitter.canBuy).toBe(false);
    expect(shieldEmitter.reason).toBe("already fitted");
  });

  it("a full system slot blocks a not-yet-fitted system", () => {
    const full = ship({ shipClass: "scout", damageReduction: 1, hasShield: true }); // systemSlots 2, both used
    const stock = shipyardStock(state({ ship: full, tags: ["blackmarket"] }));
    const pointDefense = stock.systems.find((sys) => sys.id === "pointDefense")!;
    expect(pointDefense.canBuy).toBe(false);
    expect(pointDefense.reason).toBe("no free system slot");
  });

  it("positive rep lowers the quoted price", () => {
    const cheap = shipyardStock(state({ tags: ["blackmarket"], rep: 5 }));
    const flat = shipyardStock(state({ tags: ["blackmarket"], rep: 0 }));
    expect(cheap.mounts[0].price).toBeLessThan(flat.mounts[0].price);
  });
});
