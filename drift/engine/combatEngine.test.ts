import { describe, it, expect } from "vitest";
import { spawnCombatEnemies, playerAttack, enemyAttack } from "./combatEngine";
import { fleeDC, threatLevel } from "@/shared/combat";
import type { RNG } from "./rng";
import type { CombatEnemy } from "@/shared/combat";

/** RNG: d20 fixed, all other rolls (damage, hp) return the min. */
const d20Rng = (d20: number): RNG => ({ int: (min, max) => (min === 1 && max === 20 ? d20 : min) });
const maxRng: RNG = { int: (_min, max) => max };

const enemy = (over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  id: "e-1", name: "Mook", tier: "T2", hp: 15, maxHp: 15, ac: 14, atk: 5, damage: "2d8",
  shieldReady: false, multiAttack: false, ...over,
});

describe("spawnCombatEnemies", () => {
  it("builds enemies from the tier tables, clamped 1-4; T2 mooks are UNSHIELDED", () => {
    const es = spawnCombatEnemies([{ tier: "T2", count: 9 }], maxRng);
    expect(es).toHaveLength(4); // clamped
    expect(es[0].tier).toBe("T2");
    expect(es[0].shieldReady).toBe(false); // shields are T3/boss-only now
    expect(es[0].hp).toBe(14); // T2 uniform HP (fixed [14,14])
    expect(es[0].maxHp).toBe(14);
  });

  it("shields are a T3/major defense only", () => {
    expect(spawnCombatEnemies([{ tier: "T3", count: 1 }], maxRng)[0].shieldReady).toBe(true);
    expect(spawnCombatEnemies([{ tier: "T2", count: 1, major: true }], maxRng)[0].shieldReady).toBe(true);
    expect(spawnCombatEnemies([{ tier: "T1", count: 1 }], maxRng)[0].shieldReady).toBe(false);
  });

  it("names a single enemy without a number suffix", () => {
    const es = spawnCombatEnemies([{ tier: "T1", count: 1, name: "Thug" }], maxRng);
    expect(es[0].name).toBe("Thug");
  });

  it("spawns MULTIPLE named groups — a boss plus a numbered goon pack", () => {
    // "Calvo and his two heavies" → one boss (count 1) + one goon group (count 2).
    const es = spawnCombatEnemies(
      [
        { tier: "T3", count: 1, name: "Calvo" },
        { tier: "T2", count: 2, name: "Heavy" },
      ],
      maxRng,
    );
    expect(es).toHaveLength(3);
    // Boss keeps its bare name; the pack gets numbered suffixes.
    expect(es.map((e) => e.name)).toEqual(["Calvo", "Heavy 1", "Heavy 2"]);
    // Ids stay unique across groups.
    expect(new Set(es.map((e) => e.id)).size).toBe(3);
    expect(es[0].tier).toBe("T3");
    expect(es[1].tier).toBe("T2");
  });
});

describe("playerAttack", () => {
  it("misses when the roll is under AC", () => {
    const r = playerAttack(enemy(), 2, "1d8", 0, d20Rng(5)); // 5+2=7 < 14
    expect(r.hit).toBe(false);
    expect(r.enemyHpAfter).toBe(15);
  });

  it("aim bonus can turn a miss into a hit", () => {
    const r = playerAttack(enemy({ ac: 12 }), 2, "1d8", 3, d20Rng(8)); // 8+2+3=13 >= 12
    expect(r.hit).toBe(true);
  });

  it("a shield absorbs the first hit and drops", () => {
    const r = playerAttack(enemy({ shieldReady: true }), 5, "1d8", 0, d20Rng(15));
    expect(r.hit).toBe(true);
    expect(r.damage).toBe(0);
    expect(r.shieldReadyAfter).toBe(false);
    expect(r.enemyHpAfter).toBe(15);
  });

  it("nat-20 crit = max + reroll, and can kill", () => {
    const r = playerAttack(enemy({ hp: 6 }), 5, "1d8", 0, d20Rng(20));
    expect(r.crit).toBe(true);
    expect(r.damage).toBe(8 + 1); // max(1d8)=8 + reroll(min via d20Rng non-d20 → 1)
    expect(r.killed).toBe(true);
    expect(r.enemyHpAfter).toBe(0);
  });
});

describe("enemyAttack", () => {
  it("misses under AC, hits at/over AC and rolls damage", () => {
    expect(enemyAttack(enemy(), 20, d20Rng(10)).hit).toBe(false); // 10+5=15 < 20
    const hit = enemyAttack(enemy(), 14, d20Rng(10)); // 15 >= 14
    expect(hit.hit).toBe(true);
    expect(hit.damage).toBe(2); // 2d8 min via d20Rng
  });

  it("enemy crit = max damage only (no reroll)", () => {
    const r = enemyAttack(enemy(), 14, d20Rng(20));
    expect(r.crit).toBe(true);
    expect(r.damage).toBe(16); // max(2d8)
  });
});

describe("fleeDC (escape-by-disparity)", () => {
  it("is easy when badly outmatched, harder in a fair fight", () => {
    expect(fleeDC(2, 0, 0)).toBe(5); // rookie vs T2 → 10-6=4 → floored at 5
    expect(fleeDC(0, 0, 0)).toBe(10); // even fight
    expect(fleeDC(0, 0, 3)).toBe(16); // repeated attempts climb
    expect(fleeDC(3, 0, 0)).toBe(5); // 10-9=1 → floored at 5
  });

  it("threatLevel is the highest tier present", () => {
    expect(threatLevel([enemy({ tier: "T1" }), enemy({ tier: "T3" })])).toBe(3);
  });
});
