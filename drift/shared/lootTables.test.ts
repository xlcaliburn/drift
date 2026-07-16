import { describe, it, expect } from "vitest";
import { seededRng, scriptedRng } from "@/engine/rng";
import { LOOT_TABLES, LOOT_ARCHETYPES, LOOT_TIERS, rollTableLoot } from "./lootTables";
import { catalogItem } from "./items";

describe("loot tables — authored constants, no holes", () => {
  it("authors every archetype × tier with non-empty pools", () => {
    for (const a of LOOT_ARCHETYPES) {
      for (const t of LOOT_TIERS) {
        const table = LOOT_TABLES[`${a}-${t}`];
        expect(table, `${a}-${t} missing`).toBeDefined();
        expect(table.common.length, `${a}-${t} common empty`).toBeGreaterThan(0);
        expect(table.useful.length, `${a}-${t} useful empty`).toBeGreaterThan(0);
        expect(table.credits[0]).toBeLessThanOrEqual(table.credits[1]);
      }
    }
  });

  it("only references REAL catalog consumables (a drop the engine can actually grant)", () => {
    for (const [key, table] of Object.entries(LOOT_TABLES)) {
      for (const id of table.consumables) {
        const item = catalogItem(id);
        expect(item, `${key} references unknown catalog id "${id}"`).toBeDefined();
        expect(item?.type, `${key} "${id}" is not a consumable`).toBe("consumable");
      }
    }
  });

  it("pays MORE at higher tiers for the same archetype (risk/reward holds)", () => {
    for (const a of LOOT_ARCHETYPES) {
      const [t1, t2, t3] = LOOT_TIERS.map((t) => LOOT_TABLES[`${a}-${t}`].credits);
      expect(t2[1]).toBeGreaterThan(t1[1]);
      expect(t3[1]).toBeGreaterThan(t2[1]);
    }
  });
});

describe("rollTableLoot", () => {
  it("rolls credits inside the table's band + one common find", () => {
    const drop = rollTableLoot(seededRng(3), "wreck", "T2");
    const [lo, hi] = LOOT_TABLES["wreck-T2"].credits;
    expect(drop.credits).toBeGreaterThanOrEqual(lo);
    expect(drop.credits).toBeLessThanOrEqual(hi);
    expect(drop.gear).toHaveLength(1);
    expect(LOOT_TABLES["wreck-T2"].common).toContain(drop.gear[0].name);
    expect(drop.line).toMatch(/^🎒 Scavenged:/);
  });

  it("a crit doubles the money roll and can reach a real catalog consumable", () => {
    // scripted: credits, common pick, crit credits, 1-in-3 hits (1), consumable pick
    const drop = rollTableLoot(scriptedRng([50, 0, 50, 1, 0]), "lab", "T2", { crit: true });
    expect(drop.credits).toBeGreaterThan(LOOT_TABLES["lab-T2"].credits[1]); // two rolls stacked
    expect(drop.consumables).toEqual([LOOT_TABLES["lab-T2"].consumables[0]]);
  });

  it("a crit that misses the consumable slot yields a useful find instead", () => {
    // 1-in-3 check rolls 2 → useful path
    const drop = rollTableLoot(scriptedRng([30, 0, 30, 2, 0]), "cache", "T3", { crit: true });
    expect(drop.consumables).toHaveLength(0);
    expect(drop.gear).toHaveLength(2); // common + useful
    expect(LOOT_TABLES["cache-T3"].useful).toContain(drop.gear[1].name);
  });
});
