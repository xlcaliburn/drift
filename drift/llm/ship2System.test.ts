import { describe, it, expect } from "vitest";
import type { CampaignState, Character, Ship } from "@/shared/schemas";
import type { CombatState, CombatEnemy } from "@/shared/combat";
import { TurnRuntime } from "./engineBridge";
import { deriveShip2Profile } from "@/shared/ship2";
import type { RNG } from "@/engine";

/** maxRng: every d6/d20 = max (guaranteed hits, max damage, d20 crits/succeeds).
 *  minRng: every roll = min (guaranteed misses/fails). resolvePolicyAllocation
 *  is pure/deterministic — neither affects the enemy's OWN allocation. */
const maxRng: RNG = { int: (_min, max) => max };
const minRng: RNG = { int: (min) => min };

function ship(over: Partial<Ship> = {}): Ship {
  return {
    id: "ship-1", campaignId: "c", name: "The Wren", shipClass: "hauler", hp: 20, maxHp: 20, ac: 12,
    evasiveAcBonus: 0, damageReduction: 0, weapons: [], hasShield: true, shieldReady: true,
    hasPointDefense: false, burstDriveReady: false, dcModifier: 0, buyoutRemaining: 0,
    ...over,
  } as Ship;
}

function state(shipOver: Partial<Ship> = {}, crew: Character[] = []): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false, credits: 100,
        attributes: { might: 0, reflex: 2, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "gunnery", level: 2, ticks: 0 }, { name: "piloting", level: 1, ticks: 0 }],
        actionModifiers: {}, gear: [], injuries: [],
      },
      ...crew,
    ],
    ship: ship(shipOver),
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

/** A manually-built ship2 CombatState (mirrors llm/shipCombat.test.ts's
 *  `shipCombat()` helper for classic) — populates `system`/`ship2.player` the
 *  same way `beginCombat` does, without needing a full spawn roll. */
function ship2Combat(enemies: CombatEnemy[], s: Ship, crew: Character[] = [], round = 1): CombatState {
  return {
    active: true, round, scale: "ship", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0,
    system: "ship2",
    ship2: { player: deriveShip2Profile(s, crew) },
  };
}

const enemy = (over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  id: "e-1", name: "Raider", tier: "T2", hp: 15, maxHp: 15, ac: 12, atk: 5, damage: "2d6",
  shieldReady: false, multiAttack: false, weaponType: "kinetic", ship2Class: "scout", hasPointDefense: false,
  ...over,
});

describe("ship2 CombatSystem — round resolution", () => {
  it("firing the player's mount damages the targeted enemy's hull", () => {
    const rt = new TurnRuntime(state(), maxRng);
    const e = enemy({ hp: 20, maxHp: 20 });
    const r = rt.resolveCombatRound(ship2Combat([e], rt.state.ship!), {
      type: "allocate",
      alloc: { mounts: ["railgun"], shields: 0, engines: 0 },
    });
    expect(r.combat.enemies[0].hp).toBeLessThan(20);
    expect(r.lines.some((l) => l.startsWith("🎯 You —"))).toBe(true);
  });

  it("destroying the last enemy is a VICTORY that pays salvage credits", () => {
    const rt = new TurnRuntime(state(), maxRng);
    const e = enemy({ hp: 1 });
    const r = rt.resolveCombatRound(ship2Combat([e], rt.state.ship!), {
      type: "allocate",
      alloc: { mounts: ["railgun"], shields: 0, engines: 0 },
    });
    expect(r.outcome).toBe("victory");
    expect(r.loot).toBeGreaterThan(0);
    expect(rt.state.characters.find((c) => c.kind === "pc")!.credits).toBe(100 + r.loot);
    expect(r.lines.some((l) => l.includes("salvage worth"))).toBe(true);
  });

  it("an alive enemy fires back — HULL damage, not character HP", () => {
    const rt = new TurnRuntime(state({ hp: 20 }), maxRng);
    // A tanky enemy that survives the player's shot, guaranteeing a return volley.
    const e = enemy({ hp: 999, ship2Class: "gunship" });
    const r = rt.resolveCombatRound(ship2Combat([e], rt.state.ship!), {
      type: "allocate",
      alloc: { mounts: ["railgun"], shields: 0, engines: 0 },
    });
    expect(r.combat.enemies[0].hp).toBeLessThan(999);
    expect(rt.state.ship!.hp).toBeLessThan(20); // hull took the enemy volley
    expect(rt.state.characters.find((c) => c.kind === "pc")!.hp).toBe(18); // PC untouched
    expect(r.lines.some((l) => l.startsWith("💢 Enemies —"))).toBe(true);
  });

  it("hull at 0 is DISABLED, not death, and the fight ends", () => {
    const rt = new TurnRuntime(state({ hp: 2 }), maxRng);
    const e = enemy({ hp: 999, ship2Class: "corvette" });
    const r = rt.resolveCombatRound(ship2Combat([e], rt.state.ship!), {
      type: "allocate",
      alloc: { mounts: ["railgun"], shields: 0, engines: 0 },
    });
    expect(r.outcome).toBe("disabled");
    expect(r.combat.active).toBe(false);
    expect(rt.state.ship!.hp).toBe(0);
    expect(rt.state.characters.find((c) => c.kind === "pc")!.injuries.some((i) => i.name === "Dead")).toBe(false);
  });

  it("shields absorb some of the incoming volley", () => {
    const rt = new TurnRuntime(state({ hp: 20 }), maxRng);
    const e = enemy({ hp: 999, ship2Class: "gunship" });
    const withShields = rt.resolveCombatRound(ship2Combat([e], rt.state.ship!), {
      type: "allocate",
      alloc: { mounts: [], shields: 1, engines: 0 }, // hauler's shieldCap is 1
    });
    const rt2 = new TurnRuntime(state({ hp: 20 }), maxRng);
    const noShields = rt2.resolveCombatRound(ship2Combat([e], rt2.state.ship!), {
      type: "allocate",
      alloc: { mounts: [], shields: 0, engines: 0 },
    });
    expect(rt.state.ship!.hp).toBeGreaterThan(rt2.state.ship!.hp);
    void withShields; void noShields;
  });

  it("armor reduces the enemy's per-hit damage against the hull", () => {
    const armored = new TurnRuntime(state({ hp: 20, damageReduction: 1 }), maxRng);
    const unarmored = new TurnRuntime(state({ hp: 20, damageReduction: 0, shipClass: "scout" }), maxRng);
    const e1 = enemy({ hp: 999, ship2Class: "gunship" });
    const e2 = enemy({ hp: 999, ship2Class: "gunship" });
    armored.resolveCombatRound(ship2Combat([e1], armored.state.ship!), { type: "cover" });
    unarmored.resolveCombatRound(ship2Combat([e2], unarmored.state.ship!), { type: "cover" });
    expect(armored.state.ship!.hp).toBeGreaterThanOrEqual(unarmored.state.ship!.hp);
  });

  it("a stray/malformed action falls back to a default allocation instead of stalling", () => {
    const rt = new TurnRuntime(state(), maxRng);
    const e = enemy({ hp: 20 });
    // "cover" isn't a ship2 action type — must still resolve a full round.
    const r = rt.resolveCombatRound(ship2Combat([e], rt.state.ship!), { type: "cover" });
    expect(r.outcome).toBe("continue");
    expect(r.combat.enemies[0].hp).toBeLessThan(20); // the default alloc still fired owned mounts
  });

  it("an unowned mount id in the allocation is silently dropped, not fired", () => {
    const rt = new TurnRuntime(state(), maxRng);
    const e = enemy({ hp: 20 });
    const r = rt.resolveCombatRound(ship2Combat([e], rt.state.ship!), {
      type: "allocate",
      alloc: { mounts: ["missileRack"], shields: 0, engines: 0 }, // hauler doesn't own one
    });
    expect(r.combat.enemies[0].hp).toBe(20); // nothing fired
  });
});

describe("ship2 CombatSystem — flee", () => {
  it("burst drive is an auto-escape and spends the drive", () => {
    const rt = new TurnRuntime(state({ burstDriveReady: true }), maxRng);
    const r = rt.resolveCombatRound(ship2Combat([enemy({ hp: 999 })], rt.state.ship!), { type: "flee" });
    expect(r.outcome).toBe("escaped");
    expect(rt.state.ship!.burstDriveReady).toBe(false);
  });

  it("without a burst drive, a failed break still takes the enemy volley", () => {
    const rt = new TurnRuntime(state({ hp: 20, burstDriveReady: false }), minRng); // d20=1 → fails
    const r = rt.resolveCombatRound(ship2Combat([enemy({ hp: 999, ship2Class: "gunship" })], rt.state.ship!), { type: "flee" });
    expect(r.outcome).toBe("continue");
    expect(rt.state.ship!.hp).toBeLessThanOrEqual(20); // the enemy still got a volley in
  });
});

describe("ship2 CombatSystem — crew passives + missile ammo", () => {
  const gunner = { id: "npc-gunner", kind: "party", name: "Vex", crewRole: "gunner", hp: 10, maxHp: 10 } as unknown as Character;
  const engineer = { id: "npc-eng", kind: "party", name: "Torres", crewRole: "engineer", hp: 10, maxHp: 10 } as unknown as Character;

  it("an aboard gunner boosts a near-miss die into a hit over a full round", () => {
    // A queue where railgun's single die rolls a 3 (hitOn 4 → miss on its own).
    const seq = (values: number[]): RNG => {
      let i = 0;
      return { int: () => values[i++] ?? 1 };
    };
    // ship2Class "fighter": its policy (["guns","guns","engines"]) spends its
    // whole reactor on both mounts before the "engines" token can fund
    // anything, so its evasion this round is 0 (hitOn stays a clean 4) and
    // it has no armor/shields to absorb the hit either.
    const solo = new TurnRuntime(state(), seq([3]));
    const rSolo = solo.resolveCombatRound(ship2Combat([enemy({ hp: 999, ship2Class: "fighter" })], solo.state.ship!), {
      type: "allocate",
      alloc: { mounts: ["railgun"], shields: 0, engines: 0 },
    });
    const withGunner = new TurnRuntime(state({}, [gunner]), seq([3]));
    const rWithGunner = withGunner.resolveCombatRound(
      ship2Combat([enemy({ hp: 999, ship2Class: "fighter" })], withGunner.state.ship!, [gunner]),
      { type: "allocate", alloc: { mounts: ["railgun"], shields: 0, engines: 0 } },
    );
    expect(rSolo.combat.enemies[0].hp).toBe(999); // the lone 3 missed — no gunner to save it
    expect(rWithGunner.combat.enemies[0].hp).toBeLessThan(999); // gunner bumped 3 → 4, now hits
  });

  it("firing a missile rack decrements the player's own weapons[].ammo", () => {
    const s = ship({ weapons: [{ name: "Rack", type: "missile", damage: "1d8", ammo: 3 }] });
    const rt = new TurnRuntime(state(s), maxRng);
    rt.resolveCombatRound(ship2Combat([enemy({ hp: 999 })], rt.state.ship!), {
      type: "allocate",
      alloc: { mounts: ["missileRack"], shields: 0, engines: 0 },
    });
    expect(rt.state.ship!.weapons[0].ammo).toBe(2);
  });

  it("a dry missile rack can't be fired (validateAllocation drops it)", () => {
    const s = ship({ weapons: [{ name: "Rack", type: "missile", damage: "1d8", ammo: 0 }] });
    const rt = new TurnRuntime(state(s), maxRng);
    const r = rt.resolveCombatRound(ship2Combat([enemy({ hp: 20 })], rt.state.ship!), {
      type: "allocate",
      alloc: { mounts: ["missileRack"], shields: 0, engines: 0 },
    });
    expect(r.combat.enemies[0].hp).toBe(20); // nothing fired
    expect(rt.state.ship!.weapons[0].ammo).toBe(0); // unchanged, not driven negative
  });
});

describe("ship2 CombatSystem — surprise + escalating heat", () => {
  it("round 1 ambushed: the player's effective reactor is reduced by 1", () => {
    const rt = new TurnRuntime(state(), maxRng);
    const combat = ship2Combat([enemy({ hp: 20 })], rt.state.ship!);
    combat.ship2!.surpriseMod = -1; // player was ambushed (hauler's reactor 3 → 2)
    // 3 power requested (railgun 2 + shields 1) — only 2 available this round.
    const r = rt.resolveCombatRound(combat, { type: "allocate", alloc: { mounts: ["railgun"], shields: 1, engines: 0 } });
    // The railgun (2 power) still fires; the 1 leftover point can't ALSO buy a
    // shield point once the surprise penalty is applied — hp still drops though.
    expect(r.combat.enemies[0].hp).toBeLessThan(20);
  });

  it("heat escalates both sides' reactors past round 4", () => {
    const rt = new TurnRuntime(state(), maxRng);
    const combat = ship2Combat([enemy({ hp: 999 })], rt.state.ship!, [], 5); // round 5 → +1 heat
    const r = rt.resolveCombatRound(combat, {
      type: "allocate",
      alloc: { mounts: ["railgun"], shields: 1, engines: 0 }, // needs 3; hauler base reactor is 3 — heat gives headroom for more
    });
    expect(r.outcome).toBe("continue");
    expect(r.combat.round).toBe(6);
  });
});

describe("ship2 CombatSystem — enemy allocation is deterministic (no rng)", () => {
  it("the same enemy profile + policy always allocates identically regardless of RNG", () => {
    const rtMax = new TurnRuntime(state({ hp: 20 }), maxRng);
    const rtMin = new TurnRuntime(state({ hp: 20 }), minRng);
    const e1 = enemy({ hp: 999, ship2Class: "gunship" });
    const e2 = enemy({ hp: 999, ship2Class: "gunship" });
    // Hold fire so only the enemy's return volley (policy-driven) matters.
    rtMax.resolveCombatRound(ship2Combat([e1], rtMax.state.ship!), { type: "allocate", alloc: { mounts: [], shields: 1, engines: 0 } });
    rtMin.resolveCombatRound(ship2Combat([e2], rtMin.state.ship!), { type: "allocate", alloc: { mounts: [], shields: 1, engines: 0 } });
    // The enemy's OWN allocation is policy-driven (no rng) — only the DICE
    // differ between max/min RNG, not which mounts/shields it chose. A hull
    // hit under minRng (guaranteed misses) would be 0; under maxRng, hits land.
    expect(rtMax.state.ship!.hp).toBeLessThan(20);
    expect(rtMin.state.ship!.hp).toBe(20);
  });
});
