import { describe, it, expect } from "vitest";
import { generateScavengeLoot } from "./loot";
import { seededRng } from "./rng";

describe("generateScavengeLoot — engine-owned salvage", () => {
  it("a normal success yields ONE scrap item + credits in band, nothing powerful", () => {
    const drop = generateScavengeLoot(seededRng(1), { band: [8, 30] });
    expect(drop.gear).toHaveLength(1);
    expect(drop.consumables).toEqual([]); // no mechanical items on a plain success
    expect(drop.credits).toBeGreaterThanOrEqual(8);
    expect(drop.credits).toBeLessThanOrEqual(30);
    expect(drop.line).toContain("Scavenged");
  });

  it("a crit does better — a second oddment (or a stim) and more credits", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const drop = generateScavengeLoot(seededRng(seed), { crit: true, band: [8, 30] });
      // Crit always adds a second thing on top of the base scrap.
      expect(drop.gear.length + drop.consumables.length).toBeGreaterThanOrEqual(2);
      // Two credit rolls in the band → at least 2× the floor.
      expect(drop.credits).toBeGreaterThanOrEqual(16);
    }
  });

  it("defaults to a modest band when none is given", () => {
    const drop = generateScavengeLoot(seededRng(7));
    expect(drop.credits).toBeGreaterThanOrEqual(8);
    expect(drop.credits).toBeLessThanOrEqual(30);
  });
});
