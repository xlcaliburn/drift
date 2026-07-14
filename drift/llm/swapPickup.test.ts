import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { slotsUsed, maxSlotsFor, itemCount } from "@/shared/items";
import type { RNG } from "@/engine";

const rng: RNG = { int: (_min, max) => max };

/** A PC whose pack is FULL (8 flavor items, might 0 → cap 8), holding a rifle. */
function fullPack(): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-1", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false, credits: 0,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {},
        gear: [
          { name: "Old rifle", damage: "2d6" }, // 2 slots
          ...Array.from({ length: 6 }, (_, i) => ({ name: `Trinket ${i}` })), // 6 slots
        ],
        injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [{ id: "loc-1", universeId: "u", name: "Wreck", tags: [] }],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const pc = (rt: TurnRuntime) => rt.state.characters[0];

describe("full-pack pickup parks a pending item instead of losing it (slice B)", () => {
  it("a blocked gain sets pendingPickup, doesn't add the item", () => {
    const rt = new TurnRuntime(fullPack(), rng);
    expect(slotsUsed(pc(rt))).toBe(maxSlotsFor(pc(rt))); // full: 8/8
    rt.markQuestCompleted(); // legit source
    const line = rt.applyGearChange("Plasma carbine", "gain");
    expect(line).toContain("won't fit");
    expect(rt.sceneCard.pendingPickup?.name).toBe("Plasma carbine");
    expect(rt.sceneCard.pendingPickup?.itemId).toBe("plasmaCarbine"); // resolved to catalog
    expect(pc(rt).gear.some((g) => g.name === "Plasma carbine")).toBe(false); // NOT added
  });

  it("resolveSwap drops the named item and takes the pending one", () => {
    const rt = new TurnRuntime(fullPack(), rng);
    rt.markQuestCompleted();
    rt.applyGearChange("Plasma carbine", "gain"); // parks it
    const res = rt.resolveSwap("Trinket 0");
    expect(res.line).toContain("Dropped Trinket 0");
    expect(res.line).toContain("took Plasma carbine");
    expect(pc(rt).gear.some((g) => g.name === "Trinket 0")).toBe(false);
    expect(itemCount(pc(rt), "plasmaCarbine")).toBe(1);
    expect(rt.sceneCard.pendingPickup).toBeUndefined(); // consumed
  });

  it("dropping an equal-or-bigger item frees enough room to stay under cap", () => {
    const rt = new TurnRuntime(fullPack(), rng);
    rt.markQuestCompleted();
    rt.applyGearChange("Plasma carbine", "gain"); // 2 slots
    rt.resolveSwap("Old rifle"); // drop the 2-slot rifle → carbine fits cleanly
    expect(slotsUsed(pc(rt))).toBeLessThanOrEqual(maxSlotsFor(pc(rt)));
    expect(itemCount(pc(rt), "plasmaCarbine")).toBe(1);
  });

  it("declineSwap leaves the pending item behind for good", () => {
    const rt = new TurnRuntime(fullPack(), rng);
    rt.markQuestCompleted();
    rt.applyGearChange("Plasma carbine", "gain");
    const res = rt.declineSwap();
    expect(res.line).toContain("Left Plasma carbine behind");
    expect(rt.sceneCard.pendingPickup).toBeUndefined();
    expect(pc(rt).gear.some((g) => g.name === "Plasma carbine")).toBe(false);
  });

  it("swapping in armor recomputes AC; swapping it out drops it", () => {
    const rt = new TurnRuntime(fullPack(), rng);
    rt.markQuestCompleted();
    rt.applyGearChange("Combat armor", "gain"); // +3 AC catalog armor, parked
    rt.resolveSwap("Trinket 0");
    expect(pc(rt).ac).toBe(10 + 0 + 3); // 10 + reflex 0 + best armor (+3)
  });

  it("resolveSwap errors cleanly when the drop target isn't carried", () => {
    const rt = new TurnRuntime(fullPack(), rng);
    rt.markQuestCompleted();
    rt.applyGearChange("Plasma carbine", "gain");
    expect(rt.resolveSwap("Nonexistent thing").error).toMatch(/not carrying/);
    expect(rt.sceneCard.pendingPickup?.name).toBe("Plasma carbine"); // still parked
  });

  it("a gain that FITS is added normally (no pending)", () => {
    const s = fullPack();
    s.characters[0].gear = [{ name: "Old rifle", damage: "2d6" }]; // 2/8 — room to spare
    const rt = new TurnRuntime(s, rng);
    rt.markQuestCompleted();
    const line = rt.applyGearChange("Plasma carbine", "gain");
    expect(line).toContain("Gained");
    expect(rt.sceneCard.pendingPickup).toBeUndefined();
  });
});
