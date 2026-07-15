import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { itemCount } from "@/shared/items";
import type { RNG } from "@/engine";

const rng: RNG = { int: (_min, max) => max };

function fresh(): TurnRuntime {
  const state = {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Silas", hp: 8, maxHp: 19, ac: 12, stims: 0, fragile: false, credits: 100,
        attributes: { might: 1, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
  return new TurnRuntime(state, rng);
}

describe("applyGearChange — NPC gifts of consumables (the stim-from-Draven bug)", () => {
  it("grants a gifted stim even with no loot/quest this turn", () => {
    const rt = fresh(); // lootedThisTurn = questCompletedThisTurn = false
    const line = rt.applyGearChange("stim", "gain", "loan from Draven");
    expect(line).toMatch(/gained/i);
    expect(itemCount(rt.state.characters[0], "stim")).toBe(1);
  });

  it("still BLOCKS a free weapon with no loot/quest source", () => {
    const rt = fresh();
    expect(rt.applyGearChange("laser rifle", "gain")).toBeNull();
    expect(rt.state.characters[0].gear.length).toBe(0);
  });

  it("allows a weapon once a loot roll legitimises the turn", () => {
    const rt = fresh();
    rt.markQuestCompleted(); // a legit source this turn
    expect(rt.applyGearChange("laser rifle", "gain")).toMatch(/gained/i);
  });
});
