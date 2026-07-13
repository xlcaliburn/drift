import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { CombatState, CombatEnemy } from "@/shared/combat";
import { TurnRuntime } from "./engineBridge";
import { spawnCombatShips } from "@/engine/combatEngine";
import type { RNG } from "@/engine";

const maxRng: RNG = { int: (_min, max) => max };

/** A pilot flying a weak kinetic loaner (no shield), with a burst drive. */
function withShip(hull = 18, burst = true): CampaignState {
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 8, maxHp: 8, ac: 12, stims: 0, fragile: false, credits: 100,
        attributes: { might: 0, reflex: 2, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "gunnery", level: 2, ticks: 0 }, { name: "piloting", level: 1, ticks: 0 }],
        actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    ship: {
      id: "ship-1", campaignId: "c", name: "The Wren", shipClass: "scout",
      hp: hull, maxHp: 18, ac: 12, evasiveAcBonus: 2, damageReduction: 0,
      weapons: [{ name: "Nose kinetic", type: "kinetic", damage: "2d6", count: 1 }],
      hasShield: false, shieldReady: false, hasPointDefense: false, burstDriveReady: burst,
      dcModifier: 0, buyoutRemaining: 0, notes: "",
    },
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const shipCombat = (enemies: CombatEnemy[]): CombatState => ({
  active: true, round: 1, scale: "ship", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0,
});

const shipHp = (rt: TurnRuntime) => rt.state.ship!.hp;

describe("spawnCombatShips", () => {
  it("builds enemy ships from the class tables with their defenses", () => {
    const gunships = spawnCombatShips([{ shipClass: "gunship" }], maxRng);
    expect(gunships[0].shieldReady).toBe(true); // gunship has shields
    expect(gunships[0].weaponType).toBe("kinetic");
    const scout = spawnCombatShips([{ shipClass: "scout" }], maxRng)[0];
    expect(scout.isEvasive).toBe(true);
  });
});

describe("resolveShipRound", () => {
  it("firing damages an enemy hull; destroying the last = victory + salvage", () => {
    const rt = new TurnRuntime(withShip(), maxRng);
    const enemy: CombatEnemy = { id: "e-1", name: "Cutter", tier: "T2", hp: 6, maxHp: 15, ac: 12, atk: 5, damage: "2d6", weaponType: "kinetic", shieldReady: false, multiAttack: false };
    const r = rt.resolveCombatRound(shipCombat([enemy]), { type: "attack", enemyId: "e-1" });
    expect(r.outcome).toBe("victory");
    expect(r.loot).toBeGreaterThan(0);
    expect(rt.state.characters[0].credits).toBe(100 + r.loot);
  });

  it("enemy fire damages the player's HULL (not the character), and hull 0 = disabled not death", () => {
    const rt = new TurnRuntime(withShip(6), maxRng); // fragile hull, burst off so no auto-escape
    rt.state.ship!.burstDriveReady = false;
    const enemy: CombatEnemy = { id: "e-1", name: "Cutter", tier: "T2", hp: 40, maxHp: 40, ac: 12, atk: 5, damage: "2d8", weaponType: "kinetic", shieldReady: false, multiAttack: false };
    const r = rt.resolveCombatRound(shipCombat([enemy]), { type: "cover" });
    expect(r.outcome).toBe("disabled");
    expect(shipHp(rt)).toBe(0);
    // The PILOT is not dead — disabling a hull is not a character death.
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Dead")).toBe(false);
  });

  it("burst drive is an auto-escape and spends the drive", () => {
    const rt = new TurnRuntime(withShip(18, true), maxRng);
    const enemy: CombatEnemy = { id: "e-1", name: "Corvette", tier: "T3", hp: 60, maxHp: 60, ac: 14, atk: 7, damage: "2d10", weaponType: "kinetic", shieldReady: true, multiAttack: true };
    const r = rt.resolveCombatRound(shipCombat([enemy]), { type: "flee" });
    expect(r.outcome).toBe("escaped");
    expect(rt.state.ship!.burstDriveReady).toBe(false);
  });

  it("without a burst drive, fleeing a corvette is easy for a weak ship (disparity)", () => {
    const rt = new TurnRuntime(withShip(18, false), maxRng); // d20=20 → easily clears the low DC
    const enemy: CombatEnemy = { id: "e-1", name: "Corvette", tier: "T3", hp: 60, maxHp: 60, ac: 14, atk: 7, damage: "2d10", weaponType: "kinetic", shieldReady: true, multiAttack: true };
    const r = rt.resolveCombatRound(shipCombat([enemy]), { type: "flee" });
    expect(r.outcome).toBe("escaped");
  });
});

describe("startShipCombat", () => {
  it("spawns enemy ships; a no-surprise start leaves the hull intact", () => {
    const rt = new TurnRuntime(withShip(18), maxRng);
    const { combat } = rt.startShipCombat([{ shipClass: "fighter", count: 2 }], "none");
    expect(combat.scale).toBe("ship");
    expect(combat.enemies).toHaveLength(2);
    expect(shipHp(rt)).toBe(18);
  });
});
