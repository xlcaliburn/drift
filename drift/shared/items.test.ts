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
  inferConsumableUse,
  inferShoppingIntent,
  marketChips,
  describeEffect,
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

describe("catalogue traits (weapons/armor, ITEMS.md status system)", () => {
  it("effect weapons carry a damageType + onHit; describeEffect surfaces them", () => {
    const incin = catalogItem("incinerator")!;
    expect(incin.damageType).toBe("thermal");
    expect(incin.onHit).toBe("burning");
    expect(describeEffect(incin)).toMatch(/thermal/);
    expect(describeEffect(incin)).toMatch(/burns/);
  });

  it("low-variance guns use a flat modifier; armorPen weapons carry it", () => {
    expect(catalogItem("machinePistol")!.damage).toBe("1d4+2");
    expect(catalogItem("serviceCarbine")!.damage).toBe("1d6+3");
    expect(catalogItem("railRifle")!.armorPen).toBe(3);
  });

  it("armor traits: resist/vuln/statusGuard/mobilityPenalty read + describe", () => {
    const abl = catalogItem("ablativePlating")!;
    expect(abl.resist).toBe("thermal");
    expect(abl.vuln).toBe("shock");
    expect(describeEffect(abl)).toMatch(/resists thermal/);
    expect(catalogItem("sealedHardsuit")!.statusGuard).toEqual(["burning", "corroded"]);
    expect(catalogItem("poweredCarapace")!.mobilityPenalty).toBe(true);
  });

  it("legacy freeform names map to the new mechanical items", () => {
    expect(legacyItemId("SMG")).toBe("machinePistol");
    expect(legacyItemId("a plasma rifle")).toBe("plasmaCarbine");
    expect(legacyItemId("ion pistol")).toBe("ionLance");
    expect(legacyItemId("ablative armor")).toBe("ablativePlating");
  });
});

describe("free-text consumable backstop (inferConsumableUse)", () => {
  // Wounded (hp < maxHp) — a full-HP character never triggers the backstop (below).
  const withStim = char({ stims: 1, hp: 9 }); // legacy counter → 1 stim held
  const withMedkit = char({ gear: [{ name: "Medkit", itemId: "medkit" }], hp: 9 });

  it("resolves a typed 'use stim' when a stim is held (the live bug)", () => {
    expect(inferConsumableUse("use stim", withStim)).toBe("stim");
    expect(inferConsumableUse("use item stim to heal hp", withStim)).toBe("stim");
    expect(inferConsumableUse("pop a stim", withStim)).toBe("stim");
    expect(inferConsumableUse("inject the stimpack", withStim)).toBe("stim");
    expect(inferConsumableUse("APPEAL use stim to set HP to 19/19", withStim)).toBe("stim");
  });

  it("treats the bare item name as a use-intent", () => {
    expect(inferConsumableUse("Stim", withStim)).toBe("stim");
    expect(inferConsumableUse("stim.", withStim)).toBe("stim");
  });

  it("matches a held medkit across spellings", () => {
    expect(inferConsumableUse("use my med kit", withMedkit)).toBe("medkit");
    expect(inferConsumableUse("apply medkit", withMedkit)).toBe("medkit");
  });

  it("does NOT fire for an item the player doesn't hold", () => {
    expect(inferConsumableUse("use stim", char({ stims: 0 }))).toBeUndefined();
    expect(inferConsumableUse("use medkit", withStim)).toBeUndefined();
  });

  it("ignores ordinary prose that merely mentions the word or lacks a verb", () => {
    expect(inferConsumableUse("the stim rack is empty", withStim)).toBeUndefined();
    expect(inferConsumableUse("take the stairs to deck three", withStim)).toBeUndefined();
    expect(inferConsumableUse("I ask Fingers about the stim supply", withStim)).toBeUndefined();
  });

  it("respects a decline — never spends a consumable the player wants to keep", () => {
    expect(inferConsumableUse("don't use the stim yet", withStim)).toBeUndefined();
    expect(inferConsumableUse("save my stim for later", withStim)).toBeUndefined();
  });

  it("never fires at full HP — nothing to heal (the live Sparrow +0 HP stim)", () => {
    expect(inferConsumableUse("use stim", char({ stims: 1 }))).toBeUndefined(); // char() defaults to 18/18
    expect(inferConsumableUse("use stim", char({ stims: 1, hp: 17 }))).toBe("stim");
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

describe("shop flow — inferShoppingIntent + marketChips (the Piotr sidearm case)", () => {
  it("reads buy/browse/market intent, but never social 'buy someone a drink'", () => {
    expect(inferShoppingIntent("buy a sidearm")).toBe(true);
    expect(inferShoppingIntent("Browse the market stalls")).toBe(true);
    expect(inferShoppingIntent("I want to gear up before the meet")).toBe(true);
    expect(inferShoppingIntent("what do you have for sale?")).toBe(true);
    expect(inferShoppingIntent("buy her a drink and listen")).toBe(false);
    expect(inferShoppingIntent("head back to the docks")).toBe(false);
  });

  it("marketChips: live-priced Buy chips at a market, affordable only, none elsewhere", () => {
    const at = (tags: string[], credits: number) =>
      ({
        campaign: { id: "c", universeId: "u", currentLocationId: "l", tendaysElapsed: 0 },
        universe: { id: "u" },
        characters: [char({ credits })],
        factions: [], factionRep: [],
        locations: [{ id: "l", universeId: "u", name: "Dock", tags }],
        npcs: [], clocks: [], threads: [], contracts: [],
      }) as never;
    const chips = marketChips(at(["blackmarket"], 500));
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(6);
    expect(chips[0].label).toMatch(/^Buy .+ — ¢\d+$/);
    expect(chips.every((c) => c.buyItem)).toBe(true);
    // Broke → nothing affordable → no chips (a chip is an action, not a wish list).
    expect(marketChips(at(["blackmarket"], 0))).toEqual([]);
    // No market at all (hazard/hidden site) → no chips. (An ordinary station
    // always has at least T1 basics — that's the market design, not a bug.)
    expect(marketChips(at(["hazard"], 500))).toEqual([]);
  });
});

describe("outOfCombatItemChips — deterministic use, only when useful", () => {
  it("NEVER offers personal heals out of combat — stim/medkit are combat chips", () => {
    const hurt = char({ hp: 5, maxHp: 18, gear: [{ name: "Medkit", itemId: "medkit", qty: 1 }, { name: "Stim", itemId: "stim", qty: 2 }] });
    expect(outOfCombatItemChips(hurt)).toEqual([]); // no "Use Stim/Medkit" clutter idling
  });

  it("offers hull patch only on a damaged ship, missile reload only below capacity", () => {
    const c = char({ hp: 18, maxHp: 18, gear: [{ name: "Hull patch kit", itemId: "hullPatch", qty: 1 }, { name: "Missile reload", itemId: "missileReload", qty: 1 }] });
    const damaged = outOfCombatItemChips(c, { hp: 8, maxHp: 20, weapons: [{ type: "missile", ammo: 1, count: 3 }] });
    expect(damaged.map((x) => x.useItemId).sort()).toEqual(["hullPatch", "missileReload"]);
    const pristine = outOfCombatItemChips(c, { hp: 20, maxHp: 20, weapons: [{ type: "missile", ammo: 3, count: 3 }] });
    expect(pristine).toEqual([]);
  });
});
