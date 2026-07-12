import { describe, it, expect } from "vitest";
import { resolveShipAttack, type CombatTarget } from "./combat";
import { scriptedRng } from "./rng";

const base = (over: Partial<CombatTarget>): CombatTarget => ({
  id: "t1",
  name: "Target",
  hp: 20,
  ac: 14,
  ...over,
});

describe("resolveShipAttack — interaction matrix", () => {
  it("kinetic vs evasion takes -2 to hit", () => {
    const target = base({ hp: 18, ac: 15, isEvasive: true });
    const rng = scriptedRng([14, 5, 6]); // d20=14, damage 5,6
    const r = resolveShipAttack(
      { attackerSide: "player", attackMod: 5, weaponType: "kinetic", damage: "2d8", target },
      rng,
    );
    // 14 + 5 - 2 = 17 >= 15 -> hit; damage 11, no armor mod
    expect(r.hit).toBe(true);
    expect(r.damageDealt).toBe(11);
    expect(r.targetHpAfter).toBe(7);
  });

  it("missile vs armor gets +2 damage", () => {
    const target = base({ hp: 30, ac: 13, armored: true });
    const rng = scriptedRng([10, 3, 3, 3]); // d20=10, damage 3,3,3 = 9
    const r = resolveShipAttack(
      { attackerSide: "player", attackMod: 5, weaponType: "missile", damage: "3d8", target },
      rng,
    );
    // 9 + 2 = 11
    expect(r.damageDealt).toBe(11);
    expect(r.targetHpAfter).toBe(19);
  });
});

describe("resolveShipAttack — crit rules", () => {
  it("player crit = max + reroll", () => {
    const target = base({ hp: 40, ac: 12 });
    const rng = scriptedRng([20, 3, 4]); // nat 20, reroll 3,4 = 7
    const r = resolveShipAttack(
      { attackerSide: "player", attackMod: 5, weaponType: "kinetic", damage: "2d8", target },
      rng,
    );
    expect(r.crit).toBe(true);
    expect(r.damageDealt).toBe(16 + 7); // max 2d8 = 16
  });

  it("enemy crit = max only, no reroll", () => {
    const target = base({ hp: 40, ac: 12 });
    const rng = scriptedRng([20]); // nat 20, no extra dice consumed
    const r = resolveShipAttack(
      { attackerSide: "enemy", attackMod: 5, weaponType: "kinetic", damage: "2d8", target },
      rng,
    );
    expect(r.crit).toBe(true);
    expect(r.damageDealt).toBe(16);
  });
});

describe("resolveShipAttack — shields and PD", () => {
  it("shield capacitor negates the first hit", () => {
    const target = base({ hp: 30, ac: 13, shieldReady: true });
    const rng = scriptedRng([14]);
    const r = resolveShipAttack(
      { attackerSide: "player", attackMod: 5, weaponType: "kinetic", damage: "2d8", target },
      rng,
    );
    expect(r.hit).toBe(true);
    expect(r.shieldNegated).toBe(true);
    expect(r.damageDealt).toBe(0);
    expect(r.targetShieldReadyAfter).toBe(false);
    expect(r.targetHpAfter).toBe(30);
  });

  it("ion strips a shield without dealing hull damage", () => {
    const target = base({ hp: 30, ac: 13, shieldReady: true });
    const rng = scriptedRng([14]);
    const r = resolveShipAttack(
      { attackerSide: "player", attackMod: 5, weaponType: "ion", damage: "1d6", target },
      rng,
    );
    expect(r.shieldStripped).toBe(true);
    expect(r.damageDealt).toBe(0);
    expect(r.targetShieldReadyAfter).toBe(false);
  });

  it("point-defense destroys an incoming missile on 13+", () => {
    const target = base({ hp: 30, ac: 13, hasPointDefense: true });
    const rng = scriptedRng([15]); // pd 15+3=18 >= 13
    const r = resolveShipAttack(
      { attackerSide: "enemy", attackMod: 5, weaponType: "missile", damage: "3d8", target },
      rng,
    );
    expect(r.intercepted).toBe(true);
    expect(r.damageDealt).toBe(0);
  });

  it("point-defense misses on low roll, missile proceeds", () => {
    const target = base({ hp: 30, ac: 13, hasPointDefense: true });
    const rng = scriptedRng([5, 12, 4, 4, 4]); // pd 8 fails; d20=12 hit; dmg 12
    const r = resolveShipAttack(
      { attackerSide: "enemy", attackMod: 5, weaponType: "missile", damage: "3d8", target },
      rng,
    );
    expect(r.intercepted).toBe(false);
    expect(r.hit).toBe(true);
    expect(r.damageDealt).toBe(12);
  });
});
