import { describe, it, expect } from "vitest";
import {
  legacyItemId,
  mapLegacyGear,
  gearSlotCost,
  slotsUsed,
  maxSlotsFor,
  catalogItem,
  resolveGearItemId,
  itemCount,
  outOfCombatItemChips,
} from "./items";
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

describe("resolveGearItemId — unmapped legacy gear still resolves (the medkit bug)", () => {
  it("counts a freeform 'Medkit'/'Stimpack' with no itemId as the catalog item", () => {
    expect(resolveGearItemId({ name: "Medkit" })).toBe("medkit");
    expect(resolveGearItemId({ name: "a Stimpack" })).toBe("stim");
    expect(resolveGearItemId({ name: "Medkit", itemId: "medkit" })).toBe("medkit"); // explicit wins
    expect(resolveGearItemId({ name: "Doctored transponder" })).toBeUndefined();
  });

  it("itemCount finds the medkit even when the gear entry was never mapped", () => {
    const c = char({ gear: [{ name: "Medkit", qty: 2 }] }); // NO itemId (warm legacy session)
    expect(itemCount(c, "medkit")).toBe(2);
  });
});

describe("outOfCombatItemChips — deterministic use, only when useful", () => {
  it("offers a heal chip only when hurt", () => {
    const hurt = char({ hp: 5, maxHp: 18, gear: [{ name: "Medkit", itemId: "medkit", qty: 1 }] });
    const full = char({ hp: 18, maxHp: 18, gear: [{ name: "Medkit", itemId: "medkit", qty: 1 }] });
    expect(outOfCombatItemChips(hurt).map((c) => c.useItemId)).toContain("medkit");
    expect(outOfCombatItemChips(full)).toEqual([]);
  });

  it("works off an unmapped legacy medkit too (resolves by name)", () => {
    const hurt = char({ hp: 5, maxHp: 18, gear: [{ name: "Medkit", qty: 1 }] });
    const chips = outOfCombatItemChips(hurt);
    expect(chips.map((c) => c.useItemId)).toContain("medkit");
    expect(chips[0].label).toContain("×1");
  });

  it("offers hull patch only on a damaged ship, missile reload only below capacity", () => {
    const c = char({ hp: 18, maxHp: 18, gear: [{ name: "Hull patch kit", itemId: "hullPatch", qty: 1 }, { name: "Missile reload", itemId: "missileReload", qty: 1 }] });
    const damaged = outOfCombatItemChips(c, { hp: 8, maxHp: 20, weapons: [{ type: "missile", ammo: 1, count: 3 }] });
    expect(damaged.map((x) => x.useItemId).sort()).toEqual(["hullPatch", "missileReload"]);
    const pristine = outOfCombatItemChips(c, { hp: 20, maxHp: 20, weapons: [{ type: "missile", ammo: 3, count: 3 }] });
    expect(pristine).toEqual([]);
  });
});
