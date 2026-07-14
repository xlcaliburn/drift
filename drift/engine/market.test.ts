import { describe, it, expect } from "vitest";
import { marketTierFor, marketStock, repPriceFactor, localRep, STOCK_ROTATION_DAYS } from "./market";

const loc = (id: string, tags: string[]) => ({ id, tags });

describe("marketTierFor — shelves follow the location's tags", () => {
  it("blackmarket T3 > commerce T2 > backwater T1; hazard/hidden none", () => {
    expect(marketTierFor(loc("a", ["blackmarket", "lawless"]))).toBe("T3");
    expect(marketTierFor(loc("b", ["crown", "commerce"]))).toBe("T2");
    expect(marketTierFor(loc("c", ["hostile"]))).toBe("T1");
    expect(marketTierFor(loc("d", ["hazard"]))).toBeNull();
    expect(marketTierFor(loc("e", ["lawless", "hidden"]))).toBeNull();
    expect(marketTierFor(undefined)).toBeNull();
  });
});

describe("marketStock — deterministic, rotating, tier-gated", () => {
  const rook = loc("loc-rook", ["blackmarket"]);
  const talos = loc("loc-talos", ["hostile"]);

  it("same location + same 30-day chunk → identical shelves (shared canon)", () => {
    const a = marketStock(rook, 5).map((s) => s.item.id);
    const b = marketStock(rook, 29).map((s) => s.item.id);
    expect(a).toEqual(b);
  });

  it("stock rotates when the chunk rolls", () => {
    // Across several rotations at two locations, at least one shelf must differ —
    // a static market would fail this.
    const chunks = [0, 1, 2, 3].map((k) =>
      marketStock(rook, k * STOCK_ROTATION_DAYS).map((s) => s.item.id).join(","),
    );
    expect(new Set(chunks).size).toBeGreaterThan(1);
  });

  it("a T1 backwater never shelves T2+ hardware; a blackmarket can", () => {
    for (const day of [0, 30, 60, 90, 120]) {
      for (const s of marketStock(talos, day)) {
        if (s.item.marketTier) expect(s.item.marketTier).toBe("T1");
      }
    }
    const rookAll = [0, 30, 60, 90, 120, 150].flatMap((d) => marketStock(rook, d));
    expect(rookAll.some((s) => s.item.marketTier === "T2" || s.item.marketTier === "T3")).toBe(true);
  });

  it("consumables are always on the shelves (the restock loop)", () => {
    const ids = marketStock(talos, 0).map((s) => s.item.id);
    for (const id of ["stim", "medkit", "missileReload"]) expect(ids).toContain(id);
  });

  it("no market → no stock", () => {
    expect(marketStock(loc("x", ["hazard"]), 0)).toEqual([]);
  });
});

describe("pricing", () => {
  it("rep swings buy prices ±20%", () => {
    expect(repPriceFactor(5)).toBeCloseTo(0.8);
    expect(repPriceFactor(0)).toBe(1);
    expect(repPriceFactor(-5)).toBeCloseTo(1.2);
    expect(repPriceFactor(99)).toBeCloseTo(0.8); // clamped
  });

  it("localRep reads the controlling faction from tags", () => {
    const factions = [{ id: "fac-crown", name: "Hollow Crown" }];
    const rep = [{ factionId: "fac-crown", rep: 3 }];
    expect(localRep(loc("m", ["crown", "commerce"]), factions, rep)).toBe(3);
    expect(localRep(loc("r", ["blackmarket"]), factions, rep)).toBe(0); // nobody's turf
  });
});
