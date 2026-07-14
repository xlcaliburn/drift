import { describe, it, expect } from "vitest";
import { legacyItemId, mapLegacyGear, gearSlotCost, slotsUsed, maxSlotsFor, catalogItem } from "./items";
import type { Character } from "./schemas";

function char(over: Partial<Character> = {}): Character {
  return {
    id: "pc-1",
    kind: "pc",
    name: "Test",
    attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
    hp: 18,
    maxHp: 18,
    ac: 12,
    stims: 0,
    fragile: false,
    skills: [],
    actionModifiers: {},
    gear: [],
    injuries: [],
    credits: 0,
    ...over,
  } as Character;
}

describe("legacy gear mapping (IT-1)", () => {
  it("maps creation loadout names to catalog ids — exact and alias", () => {
    expect(legacyItemId("Sidearm")).toBe("sidearm"); // exact catalog name
    expect(legacyItemId("Riot gun")).toBe("combatRifle"); // alias by what it IS (2d6)
    expect(legacyItemId("Heavy plate")).toBe("ballisticVest");
    expect(legacyItemId("a Stimpack")).toBe("stim"); // article + alias
    expect(legacyItemId("Doctored transponder")).toBeUndefined(); // true flavor
  });

  it("mapLegacyGear attaches ids, keeps names/damage, never overwrites", () => {
    const c = char({
      gear: [
        { name: "Riot gun", damage: "2d6" },
        { name: "Little black book", detail: "favors" },
        { name: "Medkit", itemId: "medkit", qty: 2 },
      ],
    });
    const m = mapLegacyGear(c);
    expect(m.gear[0]).toEqual({ name: "Riot gun", damage: "2d6", itemId: "combatRifle" });
    expect(m.gear[1].itemId).toBeUndefined();
    expect(m.gear[2].qty).toBe(2); // untouched
    // Idempotent: a second pass is a no-op (same object back).
    expect(mapLegacyGear(m)).toBe(m);
  });
});

describe("inventory slots (slice B)", () => {
  it("catalog items use listed cost; consumables stack ×3 per slot", () => {
    expect(gearSlotCost({ name: "Combat rifle", itemId: "combatRifle" })).toBe(2);
    expect(gearSlotCost({ name: "Stim", itemId: "stim", qty: 3 })).toBe(1);
    expect(gearSlotCost({ name: "Stim", itemId: "stim", qty: 4 })).toBe(2);
  });

  it("flavor gear is judged by what it is", () => {
    expect(gearSlotCost({ name: "Odd rifle", damage: "2d6" })).toBe(2); // two-hand
    expect(gearSlotCost({ name: "Odd pistol", damage: "1d8" })).toBe(1);
    expect(gearSlotCost({ name: "Odd plate", acBonus: 2 })).toBe(2);
    expect(gearSlotCost({ name: "A coil of frayed cabling" })).toBe(1);
  });

  it("slotsUsed folds in the legacy stims counter; capacity = 8 + might", () => {
    const c = char({
      stims: 2, // 1 slot (stacked)
      attributes: { might: 2, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
      gear: [
        { name: "Sidearm", itemId: "sidearm" }, // 1
        { name: "Combat rifle", itemId: "combatRifle" }, // 2
        { name: "Ballistic vest", itemId: "ballisticVest" }, // 2
      ],
    });
    expect(slotsUsed(c)).toBe(6);
    expect(maxSlotsFor(c)).toBe(10);
  });

  it("a fresh ex-military loadout fits with room to spare", () => {
    // sidearm 1 + rifle 2 + vest 2 + stims×2 1 = 6 of 8+ — pickups still possible.
    const c = char({
      stims: 2,
      gear: [
        { name: "Sidearm", itemId: "sidearm" },
        { name: "Combat rifle", itemId: "combatRifle" },
        { name: "Ballistic vest", itemId: "ballisticVest" },
      ],
    });
    expect(slotsUsed(c)).toBeLessThan(maxSlotsFor(c));
  });
});

describe("catalog price calibration (COMBAT.md net-worth bands)", () => {
  it("a mapped fresh loadout + ¢120 stays under the ¢600 T2 cutoff", () => {
    const worth =
      120 +
      (catalogItem("sidearm")?.price ?? 0) +
      (catalogItem("combatRifle")?.price ?? 0) +
      (catalogItem("ballisticVest")?.price ?? 0);
    expect(worth).toBe(570);
    expect(worth).toBeLessThan(600);
  });
});
